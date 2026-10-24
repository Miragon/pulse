/**
 * In-memory Runtime for in-process CLI tests: environment, files, stdin, terminal flags per stream,
 * captured stdout/stderr (text and bytes), a fake clock that `sleep` advances at once (so tests of
 * waiting commands run instantly), deterministic random bytes, an in-memory loopback server, a
 * recording browser, in-memory locks, a controllable deadline and a scripted shell for token
 * commands. Nothing touches the real system.
 */

import type {
  CommandOptions,
  CommandResult,
  LoopbackRequest,
  LoopbackResponse,
  LoopbackServer,
  OutputStream,
  Runtime,
} from "../../src/runtime.js"
import { fakeFileSystem, type StoredFile, toBytes, withOwners } from "./fake-fs.js"

export interface FakeStream extends OutputStream {
  readonly chunks: (string | Uint8Array)[]
  /** Everything written, decoded as UTF-8. */
  text(): string
  /** Everything written, as bytes. */
  bytes(): Uint8Array
}

export interface FakeRuntimeOptions {
  readonly env?: Readonly<Record<string, string | undefined>>
  /** Initial files by path; their parent directories exist implicitly. */
  readonly files?: Readonly<Record<string, string | Uint8Array>>
  /** Empty directories. */
  readonly dirs?: readonly string[]
  /** Paths that are neither files nor directories, e.g. symlinked directories. */
  readonly others?: readonly string[]
  /** Paths another user owns (`ownedByUser` is false for them, and for missing paths). */
  readonly foreign?: readonly string[]
  /** The file system has no owners, like on Windows (`ownedByUser` is absent). */
  readonly noOwners?: boolean
  /** stdin content; without it, reading stdin fails like a terminal would. */
  readonly stdin?: string | Uint8Array
  readonly stdoutTTY?: boolean
  readonly stderrTTY?: boolean
  /** Terminal width of stdout (only reported when stdout is a TTY). */
  readonly columns?: number
  /** Terminal width of stderr (only reported when stderr is a TTY). */
  readonly stderrColumns?: number
  readonly fetch?: typeof globalThis.fetch
  /** Clock; defaults to a fake clock starting at a fixed instant, advanced by `sleep`. */
  readonly now?: () => number
  /** Called on every `sleep` (time passes for a fake engine, e.g. its job executor runs). */
  readonly onSleep?: (ms: number) => void
  readonly homedir?: string
  readonly platform?: string
  /** Random bytes; default: deterministic, a different counter-seeded value per call. */
  readonly randomBytes?: (length: number) => Uint8Array
  /** `listenLoopback` fails with this error code (e.g. EADDRINUSE). */
  readonly listenError?: string
  /** The port an ephemeral (0) loopback listen gets; default 53682. */
  readonly loopbackPort?: number
  /**
   * What `openBrowser` resolves to (default false), or a hook called with the URL (e.g. one that
   * completes the login through the fake identity provider).
   */
  readonly browser?: boolean | ((url: string, runtime: FakeRuntime) => Promise<boolean>)
  /** `withLock` gives up at once, like a lock that cannot be taken. */
  readonly lockTimeout?: boolean
  /** `deadline` resolves at once (default: never). */
  readonly deadlineResolves?: boolean
  /**
   * File and lock names compare without case, like on macOS (APFS) and Windows (NTFS) by default:
   * a path opens an entry whose name differs only in case, and writing over an entry keeps its
   * spelling (an atomic rename over it does, observed on APFS). `files` keeps the spelling.
   */
  readonly caseInsensitive?: boolean
  /** The working directory; default the home directory (no project file is looked up there). */
  readonly cwd?: string
  /**
   * What `runCommand` answers (default: exit code 127, `sh: not found` on stderr); a function
   * gets the command line and the options, a result may leave out what it does not need.
   */
  readonly commands?: FakeCommand
}

/** The answer of the fake shell to a command line. */
type FakeCommand =
  | Partial<FakeCommandResult>
  | ((
      command: string,
      options: CommandOptions,
    ) => Partial<FakeCommandResult> | Promise<Partial<FakeCommandResult>>)

/** A command result with text output. */
interface FakeCommandResult {
  readonly exitCode: number | null
  readonly timedOut: boolean
  readonly stdout: string | Uint8Array
  readonly stderr: string | Uint8Array
}

/** The in-memory loopback server: tests drive its handler with requests. */
interface FakeLoopback {
  /** Ports passed to `listenLoopback`. */
  readonly listens: number[]
  listening: boolean
  closed: boolean
  /** Sends a request to the handler (fails when nothing listens). */
  request(
    path: string,
    query?: string | Record<string, string> | URLSearchParams,
    method?: string,
  ): Promise<LoopbackResponse>
}

export interface FakeRuntime extends Runtime {
  readonly stdout: FakeStream
  readonly stderr: FakeStream
  readonly files: Map<string, StoredFile>
  readonly dirs: Set<string>
  /** Modes passed to `mkdir`, by path. */
  readonly dirModes: Map<string, number | undefined>
  /** URLs passed to `openBrowser`. */
  readonly browserUrls: string[]
  /** Every `withLock` call: path and holdMs. */
  readonly locks: { readonly path: string; readonly holdMs: number }[]
  /** Every `sleep` in milliseconds, in order. */
  readonly sleeps: number[]
  /** Delays passed to `deadline`. */
  readonly deadlines: number[]
  /** Lengths passed to `randomBytes`. */
  readonly randomRequests: number[]
  readonly loopback: FakeLoopback
  /** Every `runCommand` call: the command line and its options. */
  readonly commandRuns: { readonly command: string; readonly options: CommandOptions }[]
}

const FIXED_NOW = 1_700_000_000_000
const HOME = "/home/tester"
/** Default config file location for HOME on Linux. */
export const CONFIG_PATH = `${HOME}/.config/pulse-cli/config.json`

const decoder = new TextDecoder()

function concat(chunks: readonly (string | Uint8Array)[]): Uint8Array {
  const parts = chunks.map(toBytes)
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

export function fakeStream(isTTY = false, columns?: number): FakeStream {
  const chunks: (string | Uint8Array)[] = []
  return {
    chunks,
    isTTY,
    ...(isTTY && columns !== undefined ? { columns } : {}),
    write(chunk) {
      chunks.push(chunk)
    },
    text: () => decoder.decode(concat(chunks)),
    bytes: () => concat(chunks),
  }
}

/** Deterministic random bytes: each call gets bytes derived from a fresh counter value. */
function counterBytes() {
  let counter = 0
  return (length: number): Uint8Array => {
    counter += 1
    return Uint8Array.from({ length }, (_, index) => (counter * 31 + index * 7) % 256)
  }
}

type Handler = (request: LoopbackRequest) => Promise<LoopbackResponse>

function fakeLoopback(options: FakeRuntimeOptions) {
  let handler: Handler | undefined
  const loopback: FakeLoopback = {
    listens: [],
    listening: false,
    closed: false,
    request(path, query = "", method = "GET") {
      if (handler === undefined || !loopback.listening) {
        return Promise.reject(new Error("the fake loopback server is not listening"))
      }
      return handler({ method, path, query: new URLSearchParams(query) })
    },
  }
  const listen = (port: number, next: Handler): Promise<LoopbackServer> => {
    loopback.listens.push(port)
    if (options.listenError !== undefined) {
      const code = options.listenError
      return Promise.reject(Object.assign(new Error(`listen ${code} 127.0.0.1:${port}`), { code }))
    }
    handler = next
    loopback.listening = true
    return Promise.resolve({
      port: port === 0 ? (options.loopbackPort ?? 53_682) : port,
      close: () => {
        loopback.listening = false
        loopback.closed = true
        return Promise.resolve()
      },
    })
  }
  return { loopback, listen }
}

/** An in-memory mutex per path; with `lockTimeout` every lock fails like a timeout. */
function fakeLocks(options: FakeRuntimeOptions, locks: FakeRuntime["locks"]) {
  const queues = new Map<string, Promise<unknown>>()
  return <T>(path: string, holdMs: number, action: () => Promise<T>): Promise<T> => {
    locks.push({ path, holdMs })
    if (options.lockTimeout === true) {
      return Promise.reject(
        new Error(`Timed out after ${2 * holdMs} ms waiting for the lock ${path}`),
      )
    }
    const key = options.caseInsensitive === true ? path.toLowerCase() : path
    const result = (queues.get(key) ?? Promise.resolve()).then(action)
    queues.set(
      key,
      result.catch(() => undefined),
    )
    return result
  }
}

const NOT_FOUND: FakeCommandResult = {
  exitCode: 127,
  timedOut: false,
  stdout: "",
  stderr: "sh: not found\n",
}

/** `runCommand` of the fake runtime: answers with `commands` and records every call. */
function fakeShell(options: FakeRuntimeOptions, runs: FakeRuntime["commandRuns"]) {
  return async (command: string, commandOptions: CommandOptions): Promise<CommandResult> => {
    runs.push({ command, options: commandOptions })
    const { commands } = options
    const answer =
      typeof commands === "function"
        ? await commands(command, commandOptions)
        : (commands ?? NOT_FOUND)
    const result = { exitCode: 0, timedOut: false, stdout: "", stderr: "", ...answer }
    return { ...result, stdout: toBytes(result.stdout), stderr: toBytes(result.stderr) }
  }
}

function rejectFetch(): Promise<Response> {
  return Promise.reject(new Error("the fake runtime has no fetch; pass one in the options"))
}

function streams(options: FakeRuntimeOptions) {
  return {
    env: options.env ?? {},
    stdout: fakeStream(options.stdoutTTY ?? false, options.columns),
    stderr: fakeStream(options.stderrTTY ?? false, options.stderrColumns),
  }
}

function fakeStdin(stdin: string | Uint8Array | undefined): () => Promise<Uint8Array> {
  return () =>
    stdin === undefined
      ? Promise.reject(new Error("stdin is a terminal in this test"))
      : Promise.resolve(toBytes(stdin))
}

function initialFiles(options: FakeRuntimeOptions): Map<string, StoredFile> {
  return new Map<string, StoredFile>(
    Object.entries(options.files ?? {}).map(([path, data]) => [path, { data: toBytes(data) }]),
  )
}

/** A fake clock starting at a fixed instant; `sleep` advances it at once and records the delay. */
function fakeClock(options: FakeRuntimeOptions) {
  const sleeps: number[] = []
  let clock = FIXED_NOW
  return {
    sleeps,
    now: options.now ?? (() => clock),
    sleep(ms: number): Promise<void> {
      sleeps.push(ms)
      clock += ms
      options.onSleep?.(ms)
      return Promise.resolve()
    },
  }
}

export function fakeRuntime(options: FakeRuntimeOptions = {}): FakeRuntime {
  const homedir = options.homedir ?? HOME
  const files = initialFiles(options)
  const dirs = new Set<string>(options.dirs ?? [])
  const others = new Set<string>(options.others ?? [])
  const dirModes = new Map<string, number | undefined>()
  const { loopback, listen } = fakeLoopback(options)
  const browserUrls: string[] = []
  const locks: FakeRuntime["locks"] = []
  const deadlines: number[] = []
  const randomRequests: number[] = []
  const commandRuns: FakeRuntime["commandRuns"] = []
  const random = options.randomBytes ?? counterBytes()
  const tree = { files, dirs, others, dirModes }
  const fs = withOwners(fakeFileSystem(tree), tree, options)
  const runtime: FakeRuntime = {
    ...streams(options),
    readStdin: fakeStdin(options.stdin),
    fetch: options.fetch ?? rejectFetch,
    fs,
    files,
    dirs,
    dirModes,
    browserUrls,
    locks,
    deadlines,
    randomRequests,
    loopback,
    commandRuns,
    cwd: options.cwd ?? homedir,
    runCommand: fakeShell(options, commandRuns),
    homedir,
    platform: options.platform ?? "linux",
    ...fakeClock(options),
    randomBytes: (length) => {
      randomRequests.push(length)
      return random(length)
    },
    listenLoopback: listen,
    openBrowser: (url) => {
      browserUrls.push(url)
      const { browser } = options
      return typeof browser === "function"
        ? browser(url, runtime)
        : Promise.resolve(browser === true)
    },
    withLock: fakeLocks(options, locks),
    deadline: (ms) => {
      deadlines.push(ms)
      return options.deadlineResolves === true ? Promise.resolve() : new Promise(() => undefined)
    },
  }
  return runtime
}

/** Text content of a file of the fake file system. */
export function fileText(runtime: FakeRuntime, path: string): string | undefined {
  const file = runtime.files.get(path)
  return file === undefined ? undefined : decoder.decode(file.data)
}

export interface Outcome {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
  readonly runtime: FakeRuntime
}

/**
 * Runs a CLI entry point (`run` of src/cli/run.ts, passed in because test support code must not
 * import the CLI layer) on a fake runtime and captures the outcome.
 */
export async function execute(
  run: (argv: readonly string[], runtime: Runtime) => Promise<number>,
  args: readonly string[],
  runtime: FakeRuntime,
): Promise<Outcome> {
  const code = await run(args, runtime)
  return { code, stdout: runtime.stdout.text(), stderr: runtime.stderr.text(), runtime }
}
