/**
 * The web app's settings (`MCP_WEB_*`), read once at boot. `MCP_WEB_CLIENT_ID` turns the web app
 * on: it signs people in through the server's own OAuth provider as a confidential client, keeps
 * the session in a cookie sealed with `MCP_WEB_SESSION_KEYS`, returns them to `MCP_URL` and serves
 * the web build in `MCP_WEB_DIR`, else in the folder the root names. `MCP_WEB_SCOPES` replaces the
 * scopes the provider's sign-in asks for (the gate's required scopes are asked for besides).
 * `MCP_WEB_SESSION_CHECK_MINUTES` has the session checked at the provider at least that often
 * (refresh.ts); unset, its token is renewed only when it is due. A setting that cannot work fails
 * the boot with what to do, and no message ever quotes a secret or a key.
 */
import type { OAuthProvider } from "../oauth-providers.js"
import { isLocalhost } from "../oauth-shared.js"

export const WEB_ENV_VARS = [
  "MCP_WEB_CLIENT_ID",
  "MCP_WEB_CLIENT_SECRET",
  "MCP_WEB_SCOPES",
  "MCP_WEB_SESSION_KEYS",
  "MCP_WEB_SESSION_HOURS",
  "MCP_WEB_SESSION_CHECK_MINUTES",
  "MCP_WEB_DIR",
] as const

/** A session key holds at least this many random bytes: the seal derives a 256-bit key from it. */
const MIN_SESSION_KEY_BYTES = 32

/** A session lasts this long from the sign-in, whatever its tokens' refreshes do. */
const DEFAULT_SESSION_HOURS = 8
const MAX_SESSION_HOURS = 24

/** The longest interval of the session's check at the provider. */
const MAX_CHECK_MINUTES = 60

export interface WebSettings {
  readonly clientId: string
  readonly clientSecret: string
  /**
   * The scopes the sign-in asks for in place of the provider's web scopes (`MCP_WEB_SCOPES`);
   * `undefined` when unset, and the provider's own apply.
   */
  readonly scopes: readonly string[] | undefined
  /** The keys the session cookie is sealed with, decoded: the first seals, every one opens. */
  readonly sessionKeys: readonly Uint8Array[]
  /** The absolute lifetime of a session, from its sign-in. */
  readonly sessionHours: number
  /**
   * How often a session is checked at the provider at least, by a refresh before its token is due;
   * `undefined` when `MCP_WEB_SESSION_CHECK_MINUTES` is unset and nothing is checked before then.
   */
  readonly sessionCheckMinutes: number | undefined
  /** The folder of the web build the app serves: `MCP_WEB_DIR`, else the one the root names. */
  readonly dir: string
  /** `MCP_URL`'s origin: where the browser reaches the app, its sign-in returns and CSRF checks. */
  readonly origin: string
}

/** The variables that only mean something beside a client id. */
const ON_WITH_THE_CLIENT = [
  "MCP_WEB_CLIENT_SECRET",
  "MCP_WEB_SCOPES",
  "MCP_WEB_SESSION_KEYS",
  "MCP_WEB_SESSION_HOURS",
  "MCP_WEB_SESSION_CHECK_MINUTES",
]

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/

const KEY_HINT =
  "one or more keys of at least 32 random bytes in base64url, separated by commas " +
  "(node -e \"console.log(require('node:crypto').randomBytes(32).toString('base64url'))\" prints one)"

const valueOf = (env: NodeJS.ProcessEnv, name: string): string | undefined =>
  env[name]?.trim() || undefined

/** A variable that would do nothing without the client id fails, so the web is never off unseen. */
function refuseStrayVariables(env: NodeJS.ProcessEnv): void {
  const stray = ON_WITH_THE_CLIENT.filter((name) => valueOf(env, name) !== undefined)
  if (stray.length === 0) return
  throw new Error(
    `${stray.join(" and ")} ${stray.length === 1 ? "is" : "are"} set, but MCP_WEB_CLIENT_ID is not, ` +
      "so the web app stays off. Set MCP_WEB_CLIENT_ID to turn it on, or unset the others.",
  )
}

function required(env: NodeJS.ProcessEnv, name: string, why: string): string {
  const value = valueOf(env, name)
  if (value === undefined) throw new Error(`MCP_WEB_CLIENT_ID is set, but ${name} is not: ${why}`)
  return value
}

/** The keys of `MCP_WEB_SESSION_KEYS`, each named by its position, never by its value. */
function sessionKeysOf(raw: string): Uint8Array[] {
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (entries.length === 0) throw new Error(`MCP_WEB_SESSION_KEYS holds no key. Set ${KEY_HINT}.`)
  return entries.map((entry, index) => {
    if (!BASE64URL.test(entry)) {
      throw new Error(
        `MCP_WEB_SESSION_KEYS: key ${index + 1} is not base64url (A-Z, a-z, 0-9, - and _). Set ${KEY_HINT}.`,
      )
    }
    const key = new Uint8Array(Buffer.from(entry, "base64url"))
    if (key.length < MIN_SESSION_KEY_BYTES) {
      throw new Error(
        `MCP_WEB_SESSION_KEYS: key ${index + 1} holds ${key.length} bytes, fewer than ${MIN_SESSION_KEY_BYTES}. Set ${KEY_HINT}.`,
      )
    }
    return key
  })
}

/** A scope token as RFC 6749 §3.3 spells one: printable ASCII but space, `"` and `\`. */
const SCOPE_TOKEN = /^[\x21\x23-\x5B\x5D-\x7E]+$/

/** The scopes of `MCP_WEB_SCOPES`, separated by spaces or commas. */
function scopesOf(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined
  const scopes = raw.split(/[\s,]/).filter(Boolean)
  if (scopes.length === 0) {
    throw new Error(
      "MCP_WEB_SCOPES holds no scope. Name the scopes, separated by spaces or commas.",
    )
  }
  const odd = scopes.find((scope) => !SCOPE_TOKEN.test(scope))
  if (odd !== undefined) {
    throw new Error(`MCP_WEB_SCOPES names "${odd}", which is no scope (RFC 6749 §3.3).`)
  }
  return [...new Set(scopes)]
}

/** A whole number from 1 to `max`, or NaN. */
const wholeUpTo = (raw: string, max: number): number => {
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN
  return value >= 1 && value <= max ? value : Number.NaN
}

function sessionHoursOf(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_SESSION_HOURS
  const hours = wholeUpTo(raw, MAX_SESSION_HOURS)
  if (Number.isNaN(hours)) {
    throw new Error(
      `MCP_WEB_SESSION_HOURS "${raw}" must be a whole number of hours from 1 to ${MAX_SESSION_HOURS}.`,
    )
  }
  return hours
}

function sessionCheckMinutesOf(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const minutes = wholeUpTo(raw, MAX_CHECK_MINUTES)
  if (Number.isNaN(minutes)) {
    throw new Error(
      `MCP_WEB_SESSION_CHECK_MINUTES "${raw}" must be a whole number of minutes from 1 to ${MAX_CHECK_MINUTES}, ` +
        "or unset to renew the session's token only when it is due.",
    )
  }
  return minutes
}

/** `MCP_URL`'s origin: https, or plain http on the machine itself, where browsers keep a secure cookie. */
function originOf(mcpUrl: string | undefined): string {
  const value = mcpUrl?.trim()
  if (!value) {
    throw new Error(
      "The web app needs MCP_URL, the server's public origin: the sign-in returns to <MCP_URL>/app/auth/callback.",
    )
  }
  if (!URL.canParse(value)) throw new Error(`MCP_URL "${value}" is not an absolute URL.`)
  const url = new URL(value)
  const plainOnLoopback = url.protocol === "http:" && isLocalhost(url)
  if (url.protocol !== "https:" && !plainOnLoopback) {
    throw new Error(
      `MCP_URL "${value}" does not use HTTPS, which the web app's session cookie needs: ` +
        "use an https:// URL (plain http:// works only on localhost).",
    )
  }
  return url.origin
}

/** What the boot hands the settings besides the env. */
export interface WebSettingsSources {
  readonly provider: OAuthProvider | undefined
  readonly mcpUrl: string | undefined
  /** The folder of the web build the root names, which `MCP_WEB_DIR` overrides. */
  readonly dir?: string
}

/**
 * The web app's settings, or `undefined` when `MCP_WEB_CLIENT_ID` leaves it off. Fails when the
 * client id comes without an OAuth provider, a client secret, session keys, a web build's folder
 * or `MCP_URL`, when a key is short, when the session hours lie outside 1 to 24 or the check's
 * minutes outside 1 to 60, and when `MCP_URL` is plain http off the machine itself.
 */
export function readWebSettings(
  env: NodeJS.ProcessEnv,
  { provider, mcpUrl, dir: rootDir }: WebSettingsSources,
): WebSettings | undefined {
  const clientId = valueOf(env, "MCP_WEB_CLIENT_ID")
  if (clientId === undefined) {
    refuseStrayVariables(env)
    return undefined
  }
  if (provider === undefined) {
    throw new Error(
      "MCP_WEB_CLIENT_ID is set, but no OAuth provider is: the web app signs people in through " +
        "the server's provider. Set one provider's MCP_OAUTH_* variables, or unset MCP_WEB_CLIENT_ID.",
    )
  }
  const clientSecret = required(
    env,
    "MCP_WEB_CLIENT_SECRET",
    "the web app signs in as a confidential client. Set the client's secret.",
  )
  const sessionKeys = sessionKeysOf(
    required(
      env,
      "MCP_WEB_SESSION_KEYS",
      `the session cookie is sealed with them. Set ${KEY_HINT}.`,
    ),
  )
  const dir = valueOf(env, "MCP_WEB_DIR") ?? rootDir
  if (dir === undefined) {
    throw new Error(
      "MCP_WEB_CLIENT_ID is set, but no web build is named: set MCP_WEB_DIR to the folder the " +
        "web app was built into.",
    )
  }
  return {
    clientId,
    clientSecret,
    scopes: scopesOf(valueOf(env, "MCP_WEB_SCOPES")),
    sessionKeys,
    sessionHours: sessionHoursOf(valueOf(env, "MCP_WEB_SESSION_HOURS")),
    sessionCheckMinutes: sessionCheckMinutesOf(valueOf(env, "MCP_WEB_SESSION_CHECK_MINUTES")),
    dir,
    origin: originOf(mcpUrl),
  }
}

/** One line for the boot log, without the secret or a key. */
export function describeWebSettings(settings: WebSettings): string {
  const keys = settings.sessionKeys.length
  const minutes = settings.sessionCheckMinutes
  const checked =
    minutes === undefined ? "" : `, checked at the identity provider every ${minutes} min`
  const scopes =
    settings.scopes === undefined ? "" : ` with the scopes ${settings.scopes.join(" ")}`
  return (
    `Web app: on at ${settings.origin}/app for client ${settings.clientId}${scopes}; sessions last ` +
    `${settings.sessionHours} h${checked}; ${keys} session ${keys === 1 ? "key" : "keys (the first seals)"}; ` +
    `web build from ${settings.dir}.`
  )
}
