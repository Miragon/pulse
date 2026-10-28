/**
 * In-memory Runtime for in-process CLI tests: environment, files, stdin, terminal flags per stream,
 * captured stdout/stderr (text and bytes), a fake clock that `sleep` advances at once (so tests of
 * waiting commands run instantly) and a scripted shell for token commands. Nothing touches the real system.
 */

import type { CommandOptions, CommandResult, OutputStream, Runtime } from "../../src/runtime.js"
import { fakeFileSystem, type StoredFile, toBytes } from "./fake-fs.js"

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

export interface FakeRuntime extends Runtime {
  readonly stdout: FakeStream
  readonly stderr: FakeStream
  readonly files: Map<string, StoredFile>
  readonly dirs: Set<string>
  /** Modes passed to `mkdir`, by path. */
  readonly dirModes: Map<string, number | undefined>
  /** Every `sleep` in milliseconds, in order. */
  readonly sleeps: number[]
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
  const commandRuns: FakeRuntime["commandRuns"] = []
  const tree = { files, dirs, others, dirModes }
  return {
    ...streams(options),
    readStdin: fakeStdin(options.stdin),
    fetch: options.fetch ?? rejectFetch,
    fs: fakeFileSystem(tree),
    files,
    dirs,
    dirModes,
    commandRuns,
    cwd: options.cwd ?? homedir,
    runCommand: fakeShell(options, commandRuns),
    homedir,
    platform: options.platform ?? "linux",
    ...fakeClock(options),
  }
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
