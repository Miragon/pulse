/**
 * The web app's wire contract, which the server's sign-in and call routes (src/web) and a page's
 * client (`/widgets`) both read, so neither half spells a path, a header or a code of its own. The
 * app lives under `/app`, without a trailing slash, like `/mcp`: the listener answers a path that
 * ends in one with 404.
 */
import type { ToolResult } from "./tool-result.js"

/**
 * The routes of the web app: its sign-in, the page's API, the page a signed-out user sees and the
 * build's assets (its `assets` folder).
 */
export const WEB_PATHS = {
  app: "/app",
  login: "/app/auth/login",
  callback: "/app/auth/callback",
  logout: "/app/auth/logout",
  session: "/app/api/session",
  call: "/app/api/call",
  signedOut: "/app/signed-out",
  assets: "/app/assets",
} as const

/**
 * The query parameters the routes read: the login route's target to return to after the sign-in,
 * and the signed-out page's reason.
 */
export const WEB_QUERY = { returnTo: "return", reason: "reason" } as const

/** The header a page's write to the API carries the session's CSRF token in. */
export const WEB_CSRF_HEADER = "x-pulse-csrf"

/**
 * The codes of the API's refusals, in its JSON answer's `code`: no session (401), a tool a page may
 * not call, and a tool that writes.
 */
export const WEB_CODES = {
  signedOut: "signed_out",
  notForPages: "WEB_NOT_FOR_PAGES",
  readOnly: "WEB_READ_ONLY",
} as const

export type WebCode = (typeof WEB_CODES)[keyof typeof WEB_CODES]

/** A refusal of the routes in JSON: the API's code where a page acts on it, and what happened. */
export interface WebRefusal {
  readonly code?: WebCode
  readonly message: string
}

/**
 * The session route's answer: the name of who is signed in, the CSRF token a page's request that
 * changes something carries in {@link WEB_CSRF_HEADER}, and when the session ends (milliseconds
 * since epoch), however often its tokens renew.
 */
export interface WebSessionInfo {
  readonly name: string
  readonly csrf: string
  readonly expiresAt: number
}

/**
 * A page's call of a server tool (`POST` {@link WEB_PATHS}`.call`): the tool's name and its
 * arguments, the body of the call route as JSON with nothing else in it. The server forwards it to
 * `/mcp` with the session's bearer token, only for a tool a view calls that only reads.
 */
export interface WebCall {
  readonly name: string
  readonly arguments?: Record<string, unknown>
}

/** The call route's answer: the tool's result as `/mcp` gave it, an `isError` one included. */
export interface WebCallAnswer {
  readonly result: ToolResult
}

/**
 * The sign-out's answer: where the browser goes next, the identity provider's end of its session
 * (which returns to the signed-out page) or the signed-out page itself.
 */
export interface WebSignOut {
  readonly location: string
}

/**
 * Why the signed-out page shows: the identity provider refused the sign-in, the session ran out,
 * the sign-in failed, the token lacks this server's audience, the user signed out, or the identity
 * provider does not answer.
 */
export const SIGNED_OUT_REASONS = [
  "denied",
  "expired",
  "failed",
  "audience",
  "signed_out",
  "unavailable",
] as const

export type SignedOutReason = (typeof SIGNED_OUT_REASONS)[number]

/** Whether a value read off the signed-out page's query names one of the reasons. */
export function isSignedOutReason(value: unknown): value is SignedOutReason {
  return SIGNED_OUT_REASONS.some((reason) => reason === value)
}
