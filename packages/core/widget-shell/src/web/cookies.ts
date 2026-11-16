/**
 * The web app's two cookies, both sealed (seal.ts), both `__Host-`: HttpOnly, Secure,
 * SameSite=Lax, Path=/ and no Domain, so no script reads them, no other host sets them and the
 * identity provider's redirect back still carries them. The session cookie holds the session in at
 * most three chunks of 3,800 bytes, under the header limits of browsers and proxies; a session that
 * needs more is a failure of its own, and chunks a shorter session no longer needs are cleared. The
 * login cookie holds a sign-in under way for ten minutes: its state, its PKCE verifier and where it
 * returns to.
 */
import type { Refused, Sealer } from "./seal.js"

export const SESSION_COOKIE = "__Host-pulse-session"
export const LOGIN_COOKIE = "__Host-pulse-login"

/** The bytes of one chunk's value; with the name and the attributes a cookie stays under 4 KiB. */
export const SESSION_CHUNK_BYTES = 3800
/** The session's chunks, the first under the cookie's own name. */
const SESSION_CHUNKS = [SESSION_COOKIE, `${SESSION_COOKIE}.1`, `${SESSION_COOKIE}.2`] as const
/** How long a sign-in may take from the login route to the callback. */
export const LOGIN_SECONDS = 600

const ATTRIBUTES = "Path=/; HttpOnly; Secure; SameSite=Lax"
/** What a sealed value consists of: base64url and the dots of compact serialization. */
const SEALED = /^[A-Za-z0-9._-]+$/

/** A request's cookies by name; a name sent twice keeps both values, so a reader can refuse it. */
export type CookieJar = ReadonlyMap<string, readonly string[]>

/** The cookies of a `Cookie` header (RFC 6265 §5.4), their values as sent, quotes taken off. */
export function parseCookies(header: string | null | undefined): CookieJar {
  const jar = new Map<string, string[]>()
  if (!header) return jar
  for (const pair of header.split(";")) {
    const at = pair.indexOf("=")
    if (at < 0) continue
    const name = pair.slice(0, at).trim()
    const value = pair
      .slice(at + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1")
    jar.set(name, [...(jar.get(name) ?? []), value])
  }
  return jar
}

const setCookie = (name: string, value: string, maxAgeSeconds: number): string =>
  `${name}=${value}; Max-Age=${maxAgeSeconds}; ${ATTRIBUTES}`

const cleared = (name: string): string => setCookie(name, "", 0)

/** The one value of a cookie, or `undefined` when the request sends it not at all or twice. */
function onlyValue(jar: CookieJar, name: string): string | undefined {
  const values = jar.get(name)
  return values?.length === 1 ? values[0] : undefined
}

/**
 * The sealed session the request carries, its chunks joined in order; `undefined` without its
 * first chunk or when a chunk comes twice.
 */
export function sessionValue(jar: CookieJar): string | undefined {
  let sealed = ""
  for (const name of SESSION_CHUNKS) {
    if (!jar.has(name)) break
    const chunk = onlyValue(jar, name)
    if (chunk === undefined) return undefined
    sealed += chunk
  }
  return sealed === "" ? undefined : sealed
}

/** The session's cookies, or why there are none: a sealed session larger than three chunks. */
type SessionCookies =
  | { readonly fits: true; readonly setCookies: readonly string[] }
  | { readonly fits: false; readonly bytes: number }

/**
 * The `Set-Cookie` values of a sealed session that expires at `expiresAt` (milliseconds since
 * epoch): its chunks, then a clearing of each chunk `carried` holds that the session no longer
 * fills.
 */
export function sessionCookies(
  sealed: string,
  expiresAt: number,
  carried: CookieJar,
  now = Date.now(),
): SessionCookies {
  if (!SEALED.test(sealed)) throw new TypeError("A session cookie holds a sealed value only")
  if (sealed.length > SESSION_CHUNK_BYTES * SESSION_CHUNKS.length) {
    return { fits: false, bytes: sealed.length }
  }
  const maxAge = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  const count = Math.ceil(sealed.length / SESSION_CHUNK_BYTES)
  const chunks = SESSION_CHUNKS.slice(0, count).map((name, index) =>
    setCookie(
      name,
      sealed.slice(index * SESSION_CHUNK_BYTES, (index + 1) * SESSION_CHUNK_BYTES),
      maxAge,
    ),
  )
  const stale = SESSION_CHUNKS.slice(count)
    .filter((name) => carried.has(name))
    .map(cleared)
  return { fits: true, setCookies: [...chunks, ...stale] }
}

/** Clears every chunk of the session, whichever the browser holds. */
export function clearedSession(): readonly string[] {
  return SESSION_CHUNKS.map(cleared)
}

/** A sign-in under way: the state and PKCE verifier its callback is checked with, and its target. */
export interface PendingLogin {
  readonly state: string
  readonly verifier: string
  readonly returnTo: string
}

/** The login cookie's `Set-Cookie` value: the sign-in sealed for this cookie, for ten minutes. */
export async function loginCookie(
  sealer: Sealer,
  login: PendingLogin,
  now = Date.now(),
): Promise<string> {
  const { state, verifier, returnTo } = login
  const sealed = await sealer.seal(
    LOGIN_COOKIE,
    { state, verifier, returnTo },
    now + LOGIN_SECONDS * 1000,
  )
  return setCookie(LOGIN_COOKIE, sealed, LOGIN_SECONDS)
}

/** A login cookie that opened: the sign-in under way. */
interface OpenedLogin {
  readonly ok: true
  readonly login: PendingLogin
}

/**
 * The sign-in the request's login cookie holds; why it does not open; or `undefined` when the
 * request sends no login cookie, or two.
 */
export async function openLogin(
  sealer: Sealer,
  jar: CookieJar,
  now = Date.now(),
): Promise<OpenedLogin | Refused | undefined> {
  const sealed = onlyValue(jar, LOGIN_COOKIE)
  if (sealed === undefined) return undefined
  const opened = await sealer.open(LOGIN_COOKIE, sealed, now)
  // Only loginCookie seals a value for this cookie's name, so an opened one is a PendingLogin.
  return opened.ok ? { ok: true, login: opened.value as PendingLogin } : opened
}

/** Clears the login cookie once its callback has run, whatever came of it. */
export function clearedLogin(): string {
  return cleared(LOGIN_COOKIE)
}
