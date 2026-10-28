/**
 * The session of `pulse-cli auth status` and the auth type it needs: a bearer token (CONFIG
 * `needs a bearer token, but profile "p" uses basic` otherwise). `auth` commands have no `--auth`
 * option, so hints never suggest one.
 */

import type { Command } from "commander"
import { configError } from "../../config/config-error.js"
import { selectedAuth } from "../../config/resolve-auth.js"
import { unusedToken, unusedTokenNote } from "../../config/resolve-bearer.js"
import { selectProfile } from "../../config/resolve.js"
import { type BearerAuthConfig, ENV, type ResolvedConfig, type Source } from "../../config/types.js"
import type { CliContext } from "../context.js"
import { configFlags, type GlobalOptions, readGlobals } from "../globals.js"
import { loadConfig } from "../config-files.js"
import { openSession, type Session } from "../session.js"

/**
 * Why a configuration does not use a bearer token: its type, where that came from, the `off`
 * reason, and the note on a token (PULSE_CLI_TOKEN) the type does not use (`unusedTokenNote`).
 */
interface NotBearer {
  readonly profile: string | undefined
  readonly type: string
  readonly source: Source
  readonly off?: string | undefined
  readonly unused?: string | undefined
}

function notBearerOf(config: ResolvedConfig): NotBearer {
  const { auth, unusedToken } = config
  const off = auth.type === "none" ? auth.off : undefined
  const unused = unusedToken === undefined ? undefined : unusedTokenNote(unusedToken, true)
  return { profile: config.profile, type: auth.type, source: config.sources.auth, off, unused }
}

/**
 * The hint: a token that is set but not used, stored bearer settings switched off by type none,
 * else how to give a token.
 */
function statusHint(state: NotBearer): string {
  if (state.unused !== undefined) return state.unused
  if (state.off?.startsWith("Bearer auth") === true) {
    const on =
      state.source === "profile"
        ? `pulse-cli config set ${state.profile ?? "<profile>"} --auth bearer`
        : `${ENV.auth}=bearer`
    return `${state.off}. Switch it on: ${on}`
  }
  return `Give a bearer token: ${ENV.tokenCommand} with a command that prints one, ${ENV.token} or --auth-token-stdin.`
}

function notBearer(state: NotBearer) {
  const owner = state.profile === undefined ? "the configuration" : `profile "${state.profile}"`
  return configError(
    `pulse-cli auth status needs a bearer token, but ${owner} uses ${state.type}`,
    statusHint(state),
  )
}

/**
 * CONFIG `needs a bearer token, but profile "p" uses basic` when the selected profile uses Basic
 * auth, decided without resolving its credentials: a Basic profile whose password variable is
 * not set must not ask for that password. An exported PULSE_CLI_TOKEN is mentioned.
 */
async function basicInstead(context: CliContext, globals: GlobalOptions) {
  const { runtime } = context
  const { env } = runtime
  try {
    const { config } = await loadConfig(runtime, globals.config)
    const flags = configFlags(globals)
    const selected = selectProfile(flags, env, config)
    const auth = selectedAuth(flags, env, selected)
    if (auth?.type !== "basic") return undefined
    const unused = unusedToken({ flags, env, selected }, "basic", auth.label)
    const note = unused === undefined ? undefined : unusedTokenNote(unused, true)
    return notBearer({ profile: selected.name, type: "basic", source: auth.source, unused: note })
  } catch {
    return undefined
  }
}

/**
 * The session of `auth status`. A piped token (`--auth-token-stdin`) keeps the error of its own
 * resolution: the user asked about the token.
 */
export async function authSession(command: Command, context: CliContext) {
  const globals = readGlobals(command)
  try {
    return await openSession(context, globals, { authCommand: true })
  } catch (error) {
    if (globals.authTokenStdin) throw error
    throw (await basicInstead(context, globals)) ?? error
  }
}

/** The bearer token settings of the session; other auth types have no token to show. */
export function bearerOf(session: Session): BearerAuthConfig {
  const { auth } = session.config
  if (auth.type !== "bearer") throw notBearer(notBearerOf(session.config))
  return auth
}
