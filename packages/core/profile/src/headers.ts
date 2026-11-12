/**
 * Extra request headers of a profile: a name must be an HTTP token the client does not manage
 * itself, a value must be sendable by fetch (ISO-8859-1, no control characters but tab). And
 * which names carry a secret, which a shared file never stores.
 */

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
/** Control characters (line breaks, NUL, ESC, DEL, ...): not part of an HTTP field value. */
const HEADER_CONTROLS = /[^\P{Cc}\t]/u
/** fetch only sends ISO-8859-1 header values; anything above U+00FF throws before the request. */
const BEYOND_LATIN1 = /[\u{100}-\u{10ffff}]/u

/**
 * Connection management headers the HTTP client sets itself: undici refuses most of them (the
 * request would fail as if the engine were unreachable) and a wrong Content-Length breaks bodies.
 */
const CLIENT_HEADERS: ReadonlySet<string> = new Set([
  "connection",
  "content-length",
  "expect",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
])

/** Headers that carry a secret by name (lower case). */
const SECRET_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
])

/** Parts of a header name that mark a secret (lower case). */
const SECRET_NAME_PARTS: readonly string[] = ["token", "secret", "password", "api-key", "apikey"]

/** True for a header name a profile may set: an HTTP token, not a connection management header. */
export function isHeaderName(name: string): boolean {
  return HEADER_NAME.test(name) && !CLIENT_HEADERS.has(name.toLowerCase())
}

/** True for a value fetch can send: no control characters but tab, only ISO-8859-1. */
export function isHeaderValue(value: string): boolean {
  return !HEADER_CONTROLS.test(value) && !BEYOND_LATIN1.test(value)
}

/** True for a header that carries a secret: credentials, cookies, a name with token, secret, … */
export function isSecretHeader(name: string): boolean {
  const lower = name.toLowerCase()
  return SECRET_HEADERS.has(lower) || SECRET_NAME_PARTS.some((part) => lower.includes(part))
}
