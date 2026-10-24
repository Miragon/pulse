/**
 * PKCE (RFC 7636) and the `state` of the authorization request, with WebCrypto only: the verifier
 * and the state are 32 random octets each, base64url encoded without padding (43 characters); the
 * S256 challenge is BASE64URL(SHA-256(ASCII(verifier))).
 */

const encoder = new TextEncoder();

/** Octets of a verifier and of a state (43 base64url characters each). */
const RANDOM_OCTETS = 32;

/** base64url without padding (RFC 7636 Appendix A). */
export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** SHA-256 of the UTF-8 (for a verifier: ASCII) encoding of `text`. */
export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

/** The S256 code challenge of a verifier. */
export async function challengeOf(verifier: string): Promise<string> {
  return base64Url(await sha256(verifier));
}

export interface PkceRequest {
  readonly verifier: string;
  readonly challenge: string;
  readonly state: string;
}

/** A fresh verifier, its challenge and a state, from two separate random values. */
export async function createPkce(
  randomBytes: (length: number) => Uint8Array,
): Promise<PkceRequest> {
  const verifier = base64Url(randomBytes(RANDOM_OCTETS));
  const state = base64Url(randomBytes(RANDOM_OCTETS));
  return { verifier, challenge: await challengeOf(verifier), state };
}
