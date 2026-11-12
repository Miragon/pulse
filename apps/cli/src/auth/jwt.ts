/**
 * The claims of a JWT, read without checking its signature by @miragon/pulse-http/oauth: bearer
 * tokens from elsewhere are often JWTs, and their expiry, subject, issuer and audience help
 * explain a rejected or expired token. Nothing here decides whether a token is trusted; the
 * engine or its gateway does that. The commands reach the reader through this module (only the
 * auth layer imports the transport); when a token counts as expired is the CLI's.
 */

export { type JwtClaims, jwtClaims } from "@miragon/pulse-http/oauth"
import type { JwtClaims } from "@miragon/pulse-http/oauth"

/** How far `exp` may lie in the past before a token counts as expired (clock skew). */
export const EXPIRY_SKEW_MS = 30_000

/** True once `exp` lies more than EXPIRY_SKEW_MS in the past; never without an `exp`. */
export function isExpired(claims: Pick<JwtClaims, "expiresAt">, now: number): boolean {
  return claims.expiresAt !== null && now - claims.expiresAt > EXPIRY_SKEW_MS
}
