/**
 * `pulse-cli auth status|login|logout` with a bearer token obtained elsewhere.
 * `auth status` shows what pulse-cli can tell about the token without sending it: where it comes
 * from (for a token command, the command, which it runs unless its token is cached) and, for a
 * JWT, subject, issuer, audience and expiry (no signature check); an expired JWT exits with
 * TOKEN_EXPIRED (exit 4) after the view. `auth login` does not apply: pulse-cli never logs in for
 * such a token. `auth logout` only removes the cached token of a token command. Never prints the
 * token.
 */

import { tokenExpired } from "../../auth/bearer.js"
import { type CommandCacheDeps, commandCachePath } from "../../auth/command-cache.js"
import { configError } from "../../config/config-error.js"
import { isExpired, type JwtClaims, jwtClaims } from "../../auth/jwt.js"
import { type Env, nonEmpty } from "../../config/pick.js"
import type { BearerSource } from "../../config/resolve-bearer.js"
import {
  type BearerAuthConfig,
  type CommandBearerConfig,
  ENV,
  type Source,
  type StaticBearerConfig,
} from "../../config/types.js"
import { type OperateError, usageError } from "../../errors.js"
import type { LogoutView } from "./auth-view.js"

export interface BearerStatusView {
  readonly type: "bearer"
  readonly profile: string | null
  /** flag, env or profile. */
  readonly source: Source
  /** `PULSE_CLI_TOKEN`, `CI_TOKEN (auth.tokenEnv of profile "p")`, ... */
  readonly origin: string
  /** The token command that printed the token, else null. */
  readonly command: string | null
  /** The token of the command came from pulse-cli's cache (the command did not run). */
  readonly cached: boolean
  readonly format: "jwt" | "opaque"
  /** `sub` of a JWT. */
  readonly subject: string | null
  /** `preferred_username` of a JWT. */
  readonly user: string | null
  readonly issuer: string | null
  readonly audience: readonly string[]
  /** `exp` of a JWT; null for opaque tokens and JWTs without `exp`. */
  readonly expiresAt: string | null
  /** `exp` lies more than 30 s in the past; false when unknown. */
  readonly expired: boolean
}

/** What the view shows of an opaque token: nothing but its source. */
const OPAQUE: JwtClaims = {
  expiresAt: null,
  subject: null,
  user: null,
  issuer: null,
  audience: [],
}

/**
 * The view of the bearer token `token` (the configured one, or the one the token command printed;
 * `cached` when it came from pulse-cli's cache).
 */
export function bearerStatusView(
  config: BearerAuthConfig,
  token: string,
  now: number,
  cached = false,
): BearerStatusView {
  const claims = jwtClaims(token)
  const { subject, user, issuer, audience, expiresAt } = claims ?? OPAQUE
  return {
    type: "bearer",
    profile: config.profile ?? null,
    source: config.source,
    origin: config.origin,
    command: config.command ?? null,
    cached,
    format: claims === undefined ? "opaque" : "jwt",
    subject,
    user,
    issuer,
    audience,
    expiresAt: expiresAt === null ? null : new Date(expiresAt).toISOString(),
    expired: isExpired({ expiresAt }, now),
  }
}

/** TOKEN_EXPIRED for a JWT whose `exp` lies more than 30 s in the past, else undefined. */
export function expiredError(config: StaticBearerConfig, now: number): OperateError | undefined {
  const expiresAt = jwtClaims(config.token)?.expiresAt ?? null
  return expiresAt !== null && isExpired({ expiresAt }, now)
    ? tokenExpired(config, expiresAt)
    : undefined
}

/**
 * What selected bearer auth for an `auth` command, which has no `--auth` option, and where its
 * token comes from (a token command: `command`).
 */
export interface BearerSelection {
  readonly profile: string | undefined
  /** Where the type came from (`ResolvedConfig.sources.auth`). */
  readonly source: Source
  readonly env: Env
  readonly token?: BearerSource | undefined
}

type Selector = "profile" | "type variable" | "token"

/** The profile's auth.type, PULSE_CLI_AUTH=bearer, or a token without any type (inferred). */
function selectorOf({ source, env }: BearerSelection): Selector {
  if (source === "profile") return "profile"
  return source === "env" && nonEmpty(env[ENV.auth]) !== undefined ? "type variable" : "token"
}

/** The flag or variable that gave the token (or token command) of a selection without a type. */
function givenBy(selection: BearerSelection): string {
  if (selection.token !== undefined) return selection.token.origin
  return selection.source === "flag" ? "--auth-token-stdin" : ENV.token
}

function selectedBy(selector: Selector, selection: BearerSelection): string {
  if (selector === "profile") return `the auth.type of profile "${selection.profile ?? ""}"`
  if (selector === "type variable") return `${ENV.auth}=bearer`
  const noun = selection.token?.command === true ? "a token command" : "a token"
  return `${noun} from ${givenBy(selection)} without an auth type`
}

/** The settings that apply once PULSE_CLI_AUTH is unset. */
function settingsOf(profile: string | undefined): string {
  return profile === undefined ? "the configuration" : `profile "${profile}"`
}

const OAUTH_SETUP = (name: string) =>
  `pulse-cli config set ${name} --auth oauth --oauth-issuer <url> --oauth-client-id <id>`

/** How `auth login` gets to an OAuth login, by what selected bearer auth. */
function loginWay(selector: Selector, selection: BearerSelection): string {
  const name = selection.profile ?? "<profile>"
  if (selector === "type variable") {
    return `To log in with OAuth instead, unset ${ENV.auth} so that the auth settings of ${settingsOf(selection.profile)} apply.`
  }
  const unset = selector === "token" ? `unset ${givenBy(selection)} and configure OAuth: ` : ""
  return `For an OAuth login run by pulse-cli: ${unset}${OAUTH_SETUP(name)}.`
}

/** How `auth logout` stops bearer auth; `config unset` only where the profile selects it. */
function logoutWay(selector: Selector, selection: BearerSelection): string {
  if (selector === "profile") {
    return `\`pulse-cli config unset ${selection.profile ?? "<profile>"} auth\` removes that setting`
  }
  return selector === "type variable"
    ? `unset ${ENV.auth} to use the auth settings of ${settingsOf(selection.profile)}`
    : `unset ${givenBy(selection)} to stop sending it`
}

/** Why `auth login` does not apply to the token of a token command, and what to run instead. */
function commandLoginHint(by: string, selection: BearerSelection): string {
  return `${capitalized(by)}: pulse-cli runs the token command (${selection.token?.origin ?? ""}) whenever it needs a token and never logs in itself; \`pulse-cli auth status\` runs it and shows the token's claims and expiry. ${loginWay(selectorOf(selection), selection)}`
}

/**
 * `auth login` or `auth logout` with a bearer token: USAGE, pulse-cli manages no such token. The
 * hint names what selected bearer auth (the profile, PULSE_CLI_AUTH, a token without a type), so it
 * never suggests removing the OAuth settings of a profile that PULSE_CLI_AUTH=bearer overrides.
 */
export function bearerNotManaged(command: string, selection: BearerSelection): OperateError {
  const selector = selectorOf(selection)
  const by = `bearer auth is selected by ${selectedBy(selector, selection)}`
  if (command !== "logout" && selection.token?.command === true) {
    return usageError(
      `pulse-cli auth ${command} does not apply to bearer tokens`,
      commandLoginHint(by, selection),
    )
  }
  const hint =
    command === "logout"
      ? `pulse-cli stores no bearer token, so there is nothing to log out (${by}); ${logoutWay(selector, selection)}. The token stays valid at the engine until it expires; revoke it with the tool that issued it.`
      : `${capitalized(by)}: pulse-cli sends a token from elsewhere (company SSO tooling, a CI secret, az account get-access-token, gcloud auth print-access-token) as it is and never logs in, refreshes or stores it. Fetch a new token with that tool and set ${ENV.token} (or the variable named by the profile's tokenEnv); \`pulse-cli auth status\` shows its expiry. ${loginWay(selector, selection)}`
  return usageError(`pulse-cli auth ${command} does not apply to bearer tokens`, hint)
}

/**
 * `auth logout` with a token command: removes pulse-cli's cached token of the command (the token
 * itself stays valid at the engine until it expires); the next command runs the command again.
 */
export async function logoutCommand(
  config: CommandBearerConfig,
  deps: CommandCacheDeps,
): Promise<LogoutView> {
  const tokenCache = await commandCachePath(config.command, deps)
  let removed: boolean
  try {
    removed = await deps.fs.remove(tokenCache)
  } catch (error) {
    throw configError(
      `Cannot remove the cached token ${tokenCache} (${error instanceof Error ? error.message : String(error)})`,
      "Check the permissions of the token directory.",
    )
  }
  return { profile: config.profile ?? null, tokenCache, removed, revoked: null }
}

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}
