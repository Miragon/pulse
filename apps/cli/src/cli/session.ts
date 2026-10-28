/**
 * The resolved setting of one command run: configuration (flag > env > profile > default), output
 * format, HTTP client and target. Shared by operation commands, `api` and `ping`.
 */

import { type AuthDeps, createAuthProvider } from "../auth/index.js"
import { withAuthNote } from "../auth/note.js"
import { pathModule, tokenDirectory, tokenPath } from "../config/file.js"
import { plainHttpHost } from "../config/bearer.js"
import { resolveConfig } from "../config/resolve.js"
import { unusedTokenNote } from "../config/resolve-bearer.js"
import { ENV, type LoadedConfig, type OutputFormat, type ResolvedConfig } from "../config/types.js"
import type { ClientOptions } from "../http/client.js"
import type { GuardOptions } from "../operation/guards.js"
import type { Target } from "../operation/request.js"
import type { RenderOptions } from "../output/render.js"
import { parseFieldList } from "../output/fields.js"
import type { Runtime } from "../runtime.js"
import { loadConfig } from "./config-files.js"
import type { CliContext } from "./context.js"
import { configFlags, type GlobalOptions } from "./globals.js"
import { maxWidthOf, terminalFormat } from "./output-format.js"
import { checkStdinUse, readStdinPassword, TOKEN } from "./stdin-password.js"
import { traceWriter } from "./trace.js"

export interface Session {
  readonly globals: GlobalOptions
  readonly config: ResolvedConfig
  /** The user's config file, or the one named by `--config` / PULSE_CLI_CONFIG. */
  readonly configPath: string
  /** The project file in effect, if any. */
  readonly projectPath: string | undefined
  /** The profiles the command sees: the config file and the project file merged. */
  readonly file: LoadedConfig | undefined
  readonly format: OutputFormat
  readonly pretty: boolean
  readonly fields: readonly string[] | undefined
}

export interface SessionOptions {
  /** `--body -`: stdin holds the body, so `--auth-password-stdin` and `--auth-token-stdin` are refused. */
  readonly bodyFromStdin?: boolean
  /** `pulse-cli auth status`: hints never suggest `--auth`. */
  readonly authCommand?: boolean
}

/**
 * Resolves the configuration and records the output format for error rendering. Reads the
 * password from stdin for `--auth-password-stdin` and the token for `--auth-token-stdin`;
 * `bodyFromStdin` (`--body -`) refuses both.
 */
export async function openSession(
  context: CliContext,
  globals: GlobalOptions,
  options: SessionOptions = {},
): Promise<Session> {
  const { runtime } = context
  const { authPasswordStdin, authTokenStdin } = globals
  checkStdinUse({
    password: authPasswordStdin,
    token: authTokenStdin,
    body: options.bodyFromStdin === true,
  })
  const files = await loadConfig(runtime, globals.config)
  const password = authPasswordStdin ? await readStdinPassword(runtime) : undefined
  const token = authTokenStdin ? await readStdinPassword(runtime, TOKEN) : undefined
  const config = resolveConfig(
    configFlags(globals, { password, token }),
    runtime.env,
    files.config,
    {
      authCommand: options.authCommand === true,
    },
  )
  const format = config.output ?? terminalFormat(runtime)
  context.state.format = format
  return {
    globals,
    config,
    configPath: files.path,
    projectPath: files.project?.path,
    file: files.config,
    format,
    pretty: globals.pretty || runtime.stdout.isTTY,
    fields: parseFieldList(globals.fields),
  }
}

export function targetOf(session: Session): Target {
  const { url, engine, headers } = session.config
  return engine === undefined ? { baseUrl: url, headers } : { baseUrl: url, engine, headers }
}

/**
 * The directory whose commands share the cached token of PULSE_CLI_TOKEN_COMMAND: the directory of
 * the project file in effect (an agent moving between the services of a repository fetches one
 * token), else the working directory.
 */
function tokenScope(projectPath: string | undefined, runtime: Runtime): string {
  return projectPath === undefined ? runtime.cwd : pathModule(runtime.platform).dirname(projectPath)
}

/**
 * What every auth provider of a session needs: files, clock, the token directory, the request
 * timeout, the shell and its scope; with `--verbose` the token command is traced.
 */
export function sessionAuthDeps(session: Session, runtime: Runtime): AuthDeps {
  const { verbose, showSecrets } = session.globals
  const tokenDir = tokenDirectory(runtime.env, runtime)
  const deps: AuthDeps = {
    fs: runtime.fs,
    now: () => runtime.now(),
    tokenDir,
    tokenPath: (fileName) => tokenPath(tokenDir, fileName, runtime.platform),
    timeoutMs: session.config.timeoutMs,
    runCommand: (command, options) => runtime.runCommand(command, options),
    scope: tokenScope(session.projectPath, runtime),
    target: { url: session.config.url, profile: session.config.profile },
  }
  return verbose ? { ...deps, trace: traceWriter(runtime.stderr, showSecrets) } : deps
}

/** What a Bearer token of an auth type is called in the plain http warning. */
const BEARER_TOKENS: Readonly<Record<string, string>> = {
  bearer: "the bearer token",
}

/**
 * The warning for a bearer token over plain http to a host
 * beyond loopback: the token is readable and reusable on the way (RFC 6750 §5.3: clients MUST use
 * TLS). Not for --dry-run (nothing is sent).
 */
function plainHttpWarning(session: Session): string | undefined {
  const { config, globals } = session
  const token = BEARER_TOKENS[config.auth.type]
  if (token === undefined || globals.dryRun) return undefined
  const host = plainHttpHost(config.url)
  return host === undefined
    ? undefined
    : `Warning: pulse-cli sends ${token} over plain http to ${host}; anyone on the network path can read and reuse it. Use https:// for the engine URL (RFC 6750 §5.3).`
}

/**
 * The note for auth failures when PULSE_CLI_TOKEN is set but Basic auth won;
 * with type none the provider's `off` reason says it already.
 */
function unusedNote(config: ResolvedConfig): string | undefined {
  const { unusedToken } = config
  return unusedToken === undefined || config.auth.type === "none"
    ? undefined
    : unusedTokenNote(unusedToken)
}

/** The HTTP client of a command. */
export function clientOf(session: Session, runtime: Runtime): ClientOptions {
  const { config, globals } = session
  const warning = plainHttpWarning(session)
  if (warning !== undefined) runtime.stderr.write(`${warning}\n`)
  const provider = createAuthProvider(config.auth, sessionAuthDeps(session, runtime))
  const client: ClientOptions = {
    fetch: runtime.fetch,
    auth: withAuthNote(provider, unusedNote(config)),
    timeoutMs: config.timeoutMs,
    now: () => runtime.now(),
  }
  return globals.verbose
    ? { ...client, trace: traceWriter(runtime.stderr, globals.showSecrets) }
    : client
}

/** Where read-only mode was switched on, for the READ_ONLY hint. */
export function readOnlySource(config: ResolvedConfig): string | undefined {
  switch (config.sources.readOnly) {
    case "flag":
      return "--read-only"
    case "env":
      return ENV.readOnly
    case "profile":
      return `profile "${config.profile ?? ""}"`
    case "default":
      return undefined
  }
}

export function guardsOf(session: Session): GuardOptions {
  const source = readOnlySource(session.config)
  return {
    readOnly: session.config.readOnly,
    ...(source === undefined ? {} : { readOnlySource: source }),
    yes: session.globals.yes,
    dryRun: session.globals.dryRun,
  }
}

/** Render options for results; `unwrap` is the XML property of the operation, if it applies. */
export function renderOptionsOf(
  session: Session,
  runtime: Runtime,
  unwrap?: string,
): RenderOptions {
  return {
    format: session.format,
    pretty: session.pretty,
    fields: session.fields,
    maxWidth: maxWidthOf(runtime),
    unwrap,
    showSecrets: session.globals.showSecrets,
    baseUrl: session.config.url,
  }
}
