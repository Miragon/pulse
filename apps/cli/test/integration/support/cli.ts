/**
 * Runs the built CLI (`dist/operate.js`) as a child process, the way an agent or a script calls it:
 * no TTY (so JSON is the default output), a clean environment and an isolated config file.
 * `OPERATE_IT_BINARY` runs a standalone executable instead, started directly.
 */

import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  cleanEnv,
  describeResult,
  type EnvOverrides,
  type ProcessResult,
  startProcess,
} from "./process.js"

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url))

/** Optional path of another CLI entry script to test instead of the built `dist/operate.js`. */
const CLI_ENV = "OPERATE_IT_CLI"
/**
 * Optional path of a standalone executable
 * (`pnpm --fail-if-no-match --filter @miragon/pulse-cli build:exe`) to test instead of a script;
 * absolute, so the existence check and the start agree whatever the working directory.
 */
const BINARY_ENV = "OPERATE_IT_BINARY"
const binaryEnv = process.env[BINARY_ENV]
const BINARY = binaryEnv === undefined || binaryEnv === "" ? undefined : resolve(binaryEnv)
const CLI_PATH =
  BINARY ??
  process.env[CLI_ENV] ??
  fileURLToPath(new URL("../../../dist/operate.js", import.meta.url))
/** Executable and leading arguments that start the CLI. */
const CLI_COMMAND: readonly [string, ...string[]] =
  BINARY === undefined ? [process.execPath, CLI_PATH] : [BINARY]

/** The `error` object of the one-line JSON error that the CLI writes to stderr. */
export interface CliError {
  readonly code: string
  readonly exitCode: number
  readonly message: string
  readonly status?: number
  readonly engineType?: string
  readonly engineMessage?: string
  readonly hint?: string
  readonly request?: { readonly method: string; readonly url: string }
  readonly data?: unknown
}

export interface CliResult extends ProcessResult {
  /** stdout parsed as JSON; throws with the full output when it is not JSON. */
  // The type parameter is an unchecked cast on purpose: tests describe the shape they expect.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  json<T = unknown>(): T
  /** The parsed `{"error": {...}}` line from stderr; throws when there is none. */
  errorJson(): CliError
  /** Command, exit code, stdout and stderr, for assertion messages. */
  readonly diagnostics: string
}

export interface CliOptions {
  /** Exported as `OPERATE_URL`. */
  readonly url?: string
  /** Exported as `OPERATE_CONFIG`. */
  readonly configFile?: string
  /** Applied last; `undefined` removes a variable (e.g. `{ OPERATE_URL: undefined }`). */
  readonly env?: EnvOverrides
  readonly stdin?: string | Uint8Array
  readonly cwd?: string
  readonly timeoutMs?: number
}

export type Cli = (args: readonly string[], options?: CliOptions) => Promise<CliResult>

/** A CLI run that is still going: stderr can be watched (e.g. for the login URL) while it runs. */
export interface RunningCli {
  readonly command: string
  /** Everything the CLI wrote to stderr so far. */
  stderr(): string
  /** Resolves with the first match of `pattern` in stderr; rejects when the CLI ends first. */
  waitForStderr(pattern: RegExp): Promise<RegExpExecArray>
  /** Waits for the CLI to end. */
  result(): Promise<CliResult>
  /** Kills the CLI (SIGKILL). */
  kill(): void
}

export type StartCli = (args: readonly string[], options?: CliOptions) => RunningCli

/** Fails with an actionable message when the CLI bundle has not been built. */
export function assertCliBuilt(): void {
  if (!existsSync(CLI_PATH)) {
    const build =
      BINARY === undefined
        ? "pnpm --fail-if-no-match --filter @miragon/pulse-cli build"
        : "pnpm --fail-if-no-match --filter @miragon/pulse-cli build:standalone && pnpm --fail-if-no-match --filter @miragon/pulse-cli build:exe"
    throw new Error(`${CLI_PATH} does not exist; run "${build}" before the integration tests`)
  }
}

function parseJson(text: string, what: string, diagnostics: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${what} is not valid JSON (${(error as Error).message})\n${diagnostics}`, {
      cause: error,
    })
  }
}

function isErrorEnvelope(value: unknown): value is { readonly error: CliError } {
  if (typeof value !== "object" || value === null || !("error" in value)) return false
  const { error } = value
  return typeof error === "object" && error !== null && "code" in error && "message" in error
}

function findErrorLine(stderr: string): CliError | undefined {
  const candidates = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .reverse()
  for (const line of candidates) {
    try {
      const parsed: unknown = JSON.parse(line)
      if (isErrorEnvelope(parsed)) return parsed.error
    } catch {
      // not a JSON line; keep looking
    }
  }
  return undefined
}

function toCliResult(result: ProcessResult): CliResult {
  const diagnostics = describeResult(result)
  return {
    ...result,
    diagnostics,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    json: <T>() => parseJson(result.stdout, "stdout", diagnostics) as T,
    errorJson: () => {
      const error = findErrorLine(result.stderr)
      if (error === undefined) throw new Error(`stderr has no JSON error line\n${diagnostics}`)
      return error
    },
  }
}

/** Starts `node dist/operate.js <args>` (or the binary); stderr can be watched while it runs. */
function startCli(args: readonly string[], options: CliOptions = {}): RunningCli {
  assertCliBuilt()
  const env = cleanEnv({
    ...(options.url === undefined ? {} : { OPERATE_URL: options.url }),
    ...(options.configFile === undefined ? {} : { OPERATE_CONFIG: options.configFile }),
    ...options.env,
  })
  const [file, ...leading] = CLI_COMMAND
  const running = startProcess(file, [...leading, ...args], {
    env,
    cwd: options.cwd ?? REPO_ROOT,
    ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  })
  return {
    command: running.command,
    stderr: () => running.stderr(),
    waitForStderr: (pattern) => running.waitForStderr(pattern),
    result: async () => toCliResult(await running.result),
    kill: () => {
      running.kill()
    },
  }
}

/** Runs `node dist/operate.js <args>` and captures exit code, stdout and stderr. */
function runCli(args: readonly string[], options: CliOptions = {}): Promise<CliResult> {
  return startCli(args, options).result()
}

function mergeOptions(defaults: CliOptions, options: CliOptions): CliOptions {
  return { ...defaults, ...options, env: { ...defaults.env, ...options.env } }
}

/** A {@link runCli} with suite defaults (engine URL, config file); per-call options win. */
export function bindCli(defaults: CliOptions): Cli {
  return (args, options = {}) => runCli(args, mergeOptions(defaults, options))
}

/** A {@link startCli} with suite defaults, like {@link bindCli}. */
export function bindStartCli(defaults: CliOptions): StartCli {
  return (args, options = {}) => startCli(args, mergeOptions(defaults, options))
}
