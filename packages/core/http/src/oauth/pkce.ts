/**
 * PKCE (RFC 7636) and the `state` of an authorization request, with WebCrypto only: the verifier
 * and the state are 32 random octets each, base64url without padding (43 characters); the S256
 * challenge is BASE64URL(SHA-256(ASCII(verifier))).
 */

/** Octets of a verifier and of a state (43 base64url characters each). */
const RANDOM_OCTETS = 32

/** base64url without padding (RFC 7636 Appendix A). */
export function base64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

/** The S256 code challenge of a verifier. */
export async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

export interface Pkce {
  readonly verifier: string
  readonly challenge: string
  readonly state: string
}

const cryptoRandom = (length: number): Uint8Array => crypto.getRandomValues(new Uint8Array(length))

/** A fresh verifier, its challenge and a state, from two separate random values. */
export async function createPkce(
  randomBytes: (length: number) => Uint8Array = cryptoRandom,
): Promise<Pkce> {
  const verifier = base64Url(randomBytes(RANDOM_OCTETS))
  const state = base64Url(randomBytes(RANDOM_OCTETS))
  return { verifier, challenge: await challengeOf(verifier), state }
}
