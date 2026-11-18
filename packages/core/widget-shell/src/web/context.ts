/**
 * What the web app's sign-in routes share: their settings, the seal, the sessions signed out at
 * this replica, the identity provider's metadata, the gate's token check, the platform they send
 * through and the log, and the answers they give. Every answer carries `Cache-Control: no-store`,
 * so no cache keeps a session's answer.
 */
import type { Platform } from "@miragon/pulse-http"
import type { ServerMetadata, TokenFailure } from "@miragon/pulse-http/oauth"
import type { GateTokenCheck } from "../oauth-gate.js"
import type { OAuthWebClient } from "../oauth-providers.js"
import {
  WEB_CODES,
  WEB_PATHS,
  WEB_QUERY,
  type SignedOutReason,
  type WebRefusal,
} from "../protocol/web.js"
import type { EndedSessions } from "./ended.js"
import type { Sealer } from "./seal.js"
import type { WebSettings } from "./settings.js"

export interface WebContext {
  readonly settings: WebSettings
  readonly sealer: Sealer
  /** The sessions signed out at this replica (ended.ts). */
  readonly ended: EndedSessions
  /** What the sign-in asks the provider for: its scopes, and the audience where it names one. */
  readonly client: OAuthWebClient
  /** The gate's resource (RFC 8707) as the protected resource names itself. */
  readonly resource: string
  /** The issuer the provider names, which a callback's `iss` must name as well (RFC 9207). */
  readonly issuer: string
  /** The claims that name the caller (the provider's, else `sub`), the first a token carries. */
  readonly callerClaims: readonly string[]
  /** The provider's metadata by discovery, `undefined` while it does not answer. */
  metadata(): Promise<ServerMetadata | undefined>
  /** The gate's own check of an access token. */
  readonly verify: GateTokenCheck
  /** The fetch the provider is reached through, and the clock. */
  readonly platform: Platform
  /** One line of the server's log, which never holds a token, a code, a state or a secret. */
  log(line: string): void
}

/** Token failures that pass by themselves: the provider cannot answer now. */
const PASSING: ReadonlySet<string> = new Set([
  "unavailable",
  "unreachable",
  "timeout",
  "rate-limited",
])

/**
 * The OAuth error codes of a provider that cannot answer now (RFC 6749 §4.1.2.1), which some send
 * from the token endpoint with a 400: no refusal of the grant.
 */
const PASSING_CODES: ReadonlySet<string> = new Set(["temporarily_unavailable", "server_error"])

/**
 * Whether the provider gave no token for a reason that passes by itself: no answer, a 5xx, a limit,
 * or an answer whose error code says it cannot answer now.
 */
export function passesBy(error: unknown): boolean {
  const { kind, code } = error as Partial<TokenFailure>
  return PASSING.has(String(kind)) || PASSING_CODES.has(String(code))
}

const NO_STORE = { "cache-control": "no-store" }

function headersOf(fields: Record<string, string>, setCookies: readonly string[]): Headers {
  const headers = new Headers({ ...NO_STORE, ...fields })
  for (const cookie of setCookies) headers.append("set-cookie", cookie)
  return headers
}

/** A redirect, with the cookies it sets. */
export function redirect(
  status: 302 | 303,
  location: string,
  setCookies: readonly string[] = [],
): Response {
  return new Response(null, { status, headers: headersOf({ location }, setCookies) })
}

/** A JSON answer, with the cookies it sets. */
export function json(status: number, body: unknown, setCookies: readonly string[] = []): Response {
  const headers = headersOf({ "content-type": "application/json" }, setCookies)
  return new Response(JSON.stringify(body), { status, headers })
}

/** The signed-out page, with the reason the browser is sent there. */
export const signedOutPage = (reason: SignedOutReason): string =>
  `${WEB_PATHS.signedOut}?${WEB_QUERY.reason}=${reason}`

/** The login route, which returns to `returnTo` (a target the return path's rule let through). */
export const loginPage = (returnTo: string): string =>
  `${WEB_PATHS.login}?${new URLSearchParams({ [WEB_QUERY.returnTo]: returnTo }).toString()}`

/** The answer to a request without a session. */
export const SIGNED_OUT: WebRefusal = {
  code: WEB_CODES.signedOut,
  message: "No session: sign in again.",
}

/** Where the provider sends the browser back to: the callback under `MCP_URL`. */
export const callbackUri = (settings: WebSettings): string =>
  `${settings.origin}${WEB_PATHS.callback}`
