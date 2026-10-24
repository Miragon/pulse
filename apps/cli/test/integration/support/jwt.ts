/**
 * Reading and forging JSON Web Tokens in the OAuth and bearer token tests. Nothing here checks a
 * signature: operate reads the claims of a bearer token only to explain it (expiry, subject,
 * issuer, audience; design §18), and the gateway is what rejects a forged one.
 */

export type Claims = Readonly<Record<string, unknown>>;

/** Header, payload or signature (0, 1, 2) of a compact JWT. */
function part(jwt: string, index: number): string {
  const value = jwt.split('.')[index];
  if (value === undefined || value === '') throw new Error(`Not a JWT: part ${index} is missing`);
  return value;
}

/** The decoded payload. */
export function claimsOf(jwt: string): Claims {
  return JSON.parse(Buffer.from(part(jwt, 1), 'base64url').toString('utf8')) as Claims;
}

/** The signature: the part of a JWT that no output may contain, even when it is cut short. */
export function signatureOf(jwt: string): string {
  return part(jwt, 2);
}

/** Whether the value has the compact form `header.payload.signature`. */
export function isJwt(value: string): boolean {
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(value);
}

/** `exp` in epoch milliseconds. */
export function expiryOf(jwt: string): number {
  const { exp } = claimsOf(jwt);
  if (typeof exp !== 'number') throw new Error('The JWT has no numeric exp claim');
  return exp * 1_000;
}

/** `aud` as a list (a single audience is a plain string in the token). */
export function audiencesOf(jwt: string): readonly unknown[] {
  return [claimsOf(jwt).aud].flat();
}

/** The JWT with some claims replaced and the original signature: well-formed, but forged. */
export function tamperedJwt(jwt: string, patch: Claims): string {
  const claims = JSON.stringify({ ...claimsOf(jwt), ...patch });
  return `${part(jwt, 0)}.${Buffer.from(claims, 'utf8').toString('base64url')}.${signatureOf(jwt)}`;
}
