/**
 * The session of `operate auth login|status` and the auth type these commands need (design
 * §16.3, §18): OAuth for login (CONFIG `needs OAuth, but profile "p" uses basic` otherwise, with
 * how to switch stored or exported OAuth settings on), OAuth or a bearer token for status, and no
 * login or logout for a bearer token from elsewhere (USAGE). `auth` commands have no `--auth`
 * option, so hints never suggest one.
 */

import type { Command } from "commander"
import { configError } from "../../config/config-error.js"
import type { Env } from "../../config/pick.js"
import { selectedAuth } from "../../config/resolve-auth.js"
import { unusedToken, unusedTokenNote } from "../../config/resolve-bearer.js"
import { oauthEnvVariable } from "../../config/resolve-oauth.js"
import { selectProfile } from "../../config/resolve.js"
import { ENV, type OAuthConfig, type ResolvedConfig, type Source } from "../../config/types.js"
import type { CliContext } from "../context.js"
import { configFlags, type GlobalOptions, readGlobals } from "../globals.js"
import { loadConfig } from "../config-files.js"
import { openSession, type Session } from "../session.js"
import { bearerNotManaged } from "./auth-bearer.js"

/**
 * Why a configuration does not use OAuth: its type, where that came from, the `off` reason, and
 * the note on a token (OPERATE_TOKEN) the type does not use (`unusedTokenNote`).
 */
export interface NotOAuth {
  readonly profile: string | undefined
  readonly type: string
  readonly source: Source
  readonly off?: string | undefined
  readonly unused?: string | undefined
}

export function notOAuthOf(config: ResolvedConfig): NotOAuth {
  const { auth, unusedToken } = config
  const off = auth.type === "none" ? auth.off : undefined
  const unused = unusedToken === undefined ? undefined : unusedTokenNote(unusedToken, true)
  return { profile: config.profile, type: auth.type, source: config.sources.auth, off, unused }
}

/**
 * The hint when OAuth is not selected: why stored or exported OAuth settings are not used (the
 * `off` reason of resolution) and how to switch them on, else how to configure OAuth. `auth`
 * commands have no `--auth` option, so the hint never suggests one.
 */
function notOAuthHint(state: NotOAuth, env: Env): string {
  const profile = state.profile ?? "<profile>"
  const variable = oauthEnvVariable(env)
  const off = state.off?.includes("OAuth") === true ? state.off : undefined
  if (off === undefined) {
    return `Configure it: operate config set ${profile} --auth oauth --oauth-issuer <url> --oauth-client-id <id>`
  }
  switch (state.source) {
    case "profile":
      return `${off}. Switch it on: operate config set ${profile} --auth oauth`
    case "env":
      return `${off}. Switch it on: ${ENV.auth}=oauth`
    default:
      // OPERATE_OAUTH_* values without any auth type
      return `OAuth settings are set (from ${variable ?? "OPERATE_OAUTH_*"}), but no auth type selects OAuth. Switch it on: ${ENV.auth}=oauth`
  }
}

/**
 * The hint of `auth status`, which also shows bearer tokens: a token that is set but not used,
 * stored bearer settings switched off by type none, else the OAuth hint plus how to check a
 * bearer token.
 */
function statusHint(state: NotOAuth, env: Env): string {
  if (state.unused !== undefined) return state.unused
  if (state.off?.startsWith("Bearer auth") === true) {
    const on =
      state.source === "profile"
        ? `operate config set ${state.profile ?? "<profile>"} --auth bearer`
        : `${ENV.auth}=bearer`
    return `${state.off}. Switch it on: ${on}`
  }
  const hint = notOAuthHint(state, env)
  // switched-off OAuth settings: switching them on is the answer
  if (state.off?.includes("OAuth") === true) return hint
  return `${hint}. For a bearer token from elsewhere: ${ENV.auth}=bearer with ${ENV.token} or --auth-token-stdin.`
}

export function notOAuth(command: string, state: NotOAuth, env: Env) {
  const owner = state.profile === undefined ? "the configuration" : `profile "${state.profile}"`
  if (command === "status") {
    return configError(
      `operate auth status needs OAuth or a bearer token, but ${owner} uses ${state.type}`,
      statusHint(state, env),
    )
  }
  return configError(
    `operate auth ${command} needs OAuth, but ${owner} uses ${state.type}`,
    notOAuthHint(state, env),
  )
}

/**
 * CONFIG `needs OAuth, but profile "p" uses basic` when the selected profile uses Basic auth
 * (USAGE for `auth login` with a bearer token), decided without resolving its credentials: a
 * Basic profile whose password variable is not set must not ask for that password when the user
 * wants to log in with OAuth. An exported OPERATE_TOKEN is mentioned (`auth status` checks it).
 */
async function otherTypeInstead(context: CliContext, globals: GlobalOptions, command: string) {
  const { runtime } = context
  const { env } = runtime
  try {
    const { config } = await loadConfig(runtime, globals.config)
    const flags = configFlags(globals)
    const selected = selectProfile(flags, env, config)
    const auth = selectedAuth(flags, env, selected)
    const profile = selected.name
    if (auth?.type === "bearer" && command === "login") {
      return bearerNotManaged(command, { profile, source: auth.source, env, token: auth.token })
    }
    if (auth?.type !== "basic") return undefined
    const unused = unusedToken({ flags, env, selected }, "basic", auth.label)
    const note = unused === undefined ? undefined : unusedTokenNote(unused, true)
    return notOAuth(command, { profile, type: "basic", source: auth.source, unused: note }, env)
  } catch {
    return undefined
  }
}

/**
 * The session of `auth login|status`. A piped token (`auth status --auth-token-stdin`) keeps the
 * error of its own resolution: the user asked about the token, not about OAuth.
 */
export async function authSession(command: Command, context: CliContext, name: string) {
  const globals = readGlobals(command)
  try {
    return await openSession(context, globals, { authCommand: true })
  } catch (error) {
    if (globals.authTokenStdin) throw error
    throw (await otherTypeInstead(context, globals, name)) ?? error
  }
}

/** The OAuth settings of the session; other auth types do not log in. */
export function oauthOf(session: Session, name: string, env: Env): OAuthConfig {
  const { auth, profile, sources } = session.config
  if (auth.type === "bearer") {
    const token = { origin: auth.origin, command: auth.command !== undefined }
    throw bearerNotManaged(name, { profile, source: sources.auth, env, token })
  }
  if (auth.type !== "oauth") throw notOAuth(name, notOAuthOf(session.config), env)
  return auth
}
