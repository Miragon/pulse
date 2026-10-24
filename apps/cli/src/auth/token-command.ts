/**
 * Running the bearer token command of OPERATE_TOKEN_COMMAND (design §23): the shell runs it in the
 * working directory with stdin closed, bounded by the request timeout; the first line of its
 * stdout is the token (a leading `Bearer ` is dropped, the rest must be an RFC 6750 b64token). A
 * command that cannot start, fails, times out or prints no token is LOGIN_FAILED (exit 4) and
 * quotes the end of its stderr. Messages never show the token, nor the command line (it may
 * contain a secret; `operate config show` prints it).
 */

import { normalizeToken } from "../config/bearer.js"
import type { CommandBearerConfig } from "../config/types.js"
import { OperateError } from "../errors.js"
import type { CommandResult, Runtime } from "../runtime.js"
import { isRecord } from "../util.js"
import type { OAuthDeps } from "./oauth/types.js"

/** What running a token command needs: the shell, the clock, the timeout and `--verbose`. */
export interface CommandDeps extends Pick<OAuthDeps, "now" | "timeoutMs" | "trace"> {
  readonly runCommand: Runtime["runCommand"]
}

/** Longest stderr excerpt a message quotes. */
const MAX_EXCERPT = 300

/** LOGIN_FAILED: the command did not give a token; `problem` says why (never the token). */
function loginFailed(config: CommandBearerConfig, problem: string): OperateError {
  return new OperateError(
    "LOGIN_FAILED",
    `The bearer token command (${config.origin}) ${problem}`,
    {
      hint: `operate runs the command with the shell in the working directory, stdin closed and bounded by the request timeout (--timeout), and takes the first line of its stdout as the token (not a JSON answer: use e.g. jq -r .access_token). Run it in a shell to see what goes wrong (\`operate config show\` prints it).`,
    },
  )
}

/** The end of stderr, control characters replaced, lines joined: what a message quotes. */
function excerpt(stderr: Uint8Array): string {
  const lines = new TextDecoder()
    .decode(stderr)
    .split(/\r?\n/)
    .map((line) => line.replace(/\p{Cc}/gu, " ").trim())
    .filter((line) => line !== "")
  const text = lines.slice(-3).join(" / ")
  return text.length > MAX_EXCERPT ? `…${text.slice(-(MAX_EXCERPT - 1))}` : text
}

/** `ENOENT`, `EACCES`, ... of a start failure, else its message. */
function reasonOf(error: unknown): string {
  const code = isRecord(error) ? error.code : undefined
  if (typeof code === "string") return code
  return error instanceof Error ? error.message : String(error)
}

/** Why the command left no output to take a token from; undefined when it succeeded. */
function failure(result: CommandResult, timeoutMs: number): string | undefined {
  if (result.timedOut) return `did not finish within ${timeoutMs} ms and was stopped`
  if (result.exitCode === 0) return undefined
  const code =
    result.exitCode === null ? "ended by a signal" : `failed with exit code ${result.exitCode}`
  const stderr = excerpt(result.stderr)
  return stderr === "" ? code : `${code}: ${stderr}`
}

/** The token on the first line of stdout; LOGIN_FAILED for anything else. */
function tokenOf(config: CommandBearerConfig, stdout: Uint8Array): string {
  const line = new TextDecoder().decode(stdout).split("\n", 1)[0] ?? ""
  if (line.trim() === "") throw loginFailed(config, "printed no token on the first line of stdout")
  try {
    return normalizeToken(line, `the command of ${config.origin}`)
  } catch (error) {
    if (!(error instanceof OperateError)) throw error
    throw new OperateError("LOGIN_FAILED", error.message, error.details)
  }
}

/** Runs the command and returns its token. Traces the run with `--verbose`, never the token. */
export async function runTokenCommand(
  config: CommandBearerConfig,
  deps: CommandDeps,
): Promise<string> {
  deps.trace?.({ type: "note", message: `Running the bearer token command of ${config.origin}.` })
  let result: CommandResult
  try {
    result = await deps.runCommand(config.command, { timeoutMs: deps.timeoutMs })
  } catch (error) {
    throw loginFailed(config, `could not be started (${reasonOf(error)})`)
  }
  const problem = failure(result, deps.timeoutMs)
  if (problem !== undefined) throw loginFailed(config, problem)
  return tokenOf(config, result.stdout)
}
