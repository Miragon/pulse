/**
 * `pulse-cli auth status`: what pulse-cli can tell about the bearer token without sending it:
 * where it comes from (for a token command, the command, which it runs unless its token is cached)
 * and, for a JWT, subject, issuer, audience and expiry (no signature check); an expired JWT exits
 * with TOKEN_EXPIRED (exit 4) after the view. Never prints the token.
 */

import { tokenExpired } from "../../auth/bearer.js"
import { isExpired, type JwtClaims, jwtClaims } from "../../auth/jwt.js"
import type { BearerAuthConfig, Source, StaticBearerConfig } from "../../config/types.js"
import type { PulseCliError } from "../../errors.js"

export interface BearerStatusView {
  readonly type: "bearer"
  readonly profile: string | null
  /** flag, env or profile. */
  readonly source: Source
  /** `PULSE_CLI_TOKEN`, `CI_TOKEN (auth.tokenEnv of profile "p")`, ... */
  readonly origin: string
  /** The token command that printed the token, else null. */
  readonly command: string | null
  /** The token of the command came from pulse-cli's cache (the command did not run). */
  readonly cached: boolean
  readonly format: "jwt" | "opaque"
  /** `sub` of a JWT. */
  readonly subject: string | null
  /** `preferred_username` of a JWT. */
  readonly user: string | null
  readonly issuer: string | null
  readonly audience: readonly string[]
  /** `exp` of a JWT; null for opaque tokens and JWTs without `exp`. */
  readonly expiresAt: string | null
  /** `exp` lies more than 30 s in the past; false when unknown. */
  readonly expired: boolean
}

/** What the view shows of an opaque token: nothing but its source. */
const OPAQUE: JwtClaims = {
  expiresAt: null,
  subject: null,
  user: null,
  issuer: null,
  audience: [],
}

/**
 * The view of the bearer token `token` (the configured one, or the one the token command printed;
 * `cached` when it came from pulse-cli's cache).
 */
export function bearerStatusView(
  config: BearerAuthConfig,
  token: string,
  now: number,
  cached = false,
): BearerStatusView {
  const claims = jwtClaims(token)
  const { subject, user, issuer, audience, expiresAt } = claims ?? OPAQUE
  return {
    type: "bearer",
    profile: config.profile ?? null,
    source: config.source,
    origin: config.origin,
    command: config.command ?? null,
    cached,
    format: claims === undefined ? "opaque" : "jwt",
    subject,
    user,
    issuer,
    audience,
    expiresAt: expiresAt === null ? null : new Date(expiresAt).toISOString(),
    expired: isExpired({ expiresAt }, now),
  }
}

/** TOKEN_EXPIRED for a JWT whose `exp` lies more than 30 s in the past, else undefined. */
export function expiredError(config: StaticBearerConfig, now: number): PulseCliError | undefined {
  const expiresAt = jwtClaims(config.token)?.expiresAt ?? null
  return expiresAt !== null && isExpired({ expiresAt }, now)
    ? tokenExpired(config, expiresAt)
    : undefined
}
