/**
 * The one credential seam of every transport. A credential gives the Authorization header and
 * the secrets to mask PER REQUEST (so two callers passing their own token through one transport
 * never see each other's), and says after a 401 whether it renewed, which earns exactly one
 * second attempt. Where a secret comes from (a flag, a variable, a secret store, the MCP caller)
 * stays with each surface.
 */

/** The header a request carries and the secrets in it, which every text from the server is masked with. */
export interface Authorization {
  readonly header: string
  readonly secrets: readonly string[]
}

export interface Credential {
  readonly scheme: "none" | "basic" | "bearer"
  /** Whether `rejected` can ever answer true; only then may a 401 earn a second attempt. */
  readonly renewable: boolean
  authorization(): Promise<Authorization | undefined>
  /** After a 401 to `sent`: true means renewed, so the request goes out once more. */
  rejected(sent: Authorization): Promise<boolean>
}

/** Where a bearer token comes from: a fixed one, the MCP caller's, or a provider that renews (OAuth). */
export interface TokenSource {
  readonly renewable: boolean
  /**
   * The token for the next request, none for no header. A {@link CredentialError} fails the
   * request as "credential"; any other error (the provider's own, an identity provider that is
   * down) reaches the caller of the transport as it is, nothing sent, so a provider throws what
   * its own reader words and shows no secret in it.
   */
  token(): Promise<string | undefined>
  rejected(sent: string): Promise<boolean>
}

/** What is wrong with a credential; never its value. */
export type CredentialProblem = "user-colon" | "control-character" | "token-syntax"

/** A credential that cannot be sent. Its message names the problem, never the value. */
export class CredentialError extends Error {
  override readonly name = "CredentialError"

  constructor(readonly problem: CredentialProblem) {
    super(`credential refused: ${problem}`)
  }
}

const never = (): Promise<boolean> => Promise.resolve(false)

export const noCredential: Credential = {
  scheme: "none",
  renewable: false,
  authorization: () => Promise.resolve(undefined),
  rejected: never,
}

/** Whether `text` holds a control character (U+0000 to U+001F, U+007F): each is one code unit. */
function hasControlCharacter(text: string): boolean {
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/** Standard Base64 of the UTF-8 encoding of `text`. */
export function base64(text: string): string {
  let binary = ""
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * HTTP Basic (RFC 7617) with UTF-8, so a password with `€` works as in a browser. A user id with
 * a colon or a control character anywhere is a {@link CredentialError}.
 */
export function basicCredential(username: string, password: string): Credential {
  if (username.includes(":")) throw new CredentialError("user-colon")
  if (hasControlCharacter(username) || hasControlCharacter(password)) {
    throw new CredentialError("control-character")
  }
  const value = base64(`${username}:${password}`)
  const authorization: Authorization = { header: `Basic ${value}`, secrets: [password, value] }
  return {
    scheme: "basic",
    renewable: false,
    authorization: () => Promise.resolve(authorization),
    rejected: never,
  }
}

/** RFC 6750's b64token. */
const B64TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/
const BEARER_PREFIX = /^bearer\s+/i

/**
 * A bearer token as sent: trimmed (a secret file's final line break), a pasted `Bearer ` prefix
 * dropped; anything that is then no b64token (a line break inside) is a
 * {@link CredentialError}, which never echoes it.
 */
export function bearerToken(raw: string): string {
  const token = raw.trim().replace(BEARER_PREFIX, "")
  if (!B64TOKEN.test(token)) throw new CredentialError("token-syntax")
  return token
}

/** A bearer credential over a token source; no token means no header. */
export function bearerCredential(source: TokenSource): Credential {
  return {
    scheme: "bearer",
    renewable: source.renewable,
    async authorization() {
      const raw = await source.token()
      if (raw === undefined || raw.trim() === "") return undefined
      const token = bearerToken(raw)
      return { header: `Bearer ${token}`, secrets: [token] }
    },
    rejected: (sent) => source.rejected(sent.header.slice("Bearer ".length)),
  }
}

/** One fixed token, checked now (at boot, not at the first request); never renewed. */
export function staticToken(token: string): TokenSource {
  const checked = bearerToken(token)
  return { renewable: false, token: () => Promise.resolve(checked), rejected: never }
}

/**
 * Passthrough: the token of whoever is calling, read for every request (the MCP server's
 * verified caller token); never renewed, since it is not ours to renew.
 */
export function callerToken(read: () => string | undefined): TokenSource {
  return { renewable: false, token: () => Promise.resolve(read()), rejected: never }
}
