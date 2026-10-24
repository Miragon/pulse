/**
 * Bearer tokens obtained outside operate (design §18): company SSO tooling, a CI secret, `az
 * account get-access-token`, `gcloud auth print-access-token`. operate sends `Authorization:
 * Bearer <token>` and nothing else: no login, no refresh, no cache. A JWT whose `exp` lies more
 * than 30 s in the past fails before any request with TOKEN_EXPIRED (exit 4); the claims also
 * explain a 401 or 403. Opaque tokens are sent as they are. Never shows the token.
 */

import { ENV, type StaticBearerConfig } from '../config/types.js';
import { OperateError } from '../errors.js';
import { isExpired, type JwtClaims, jwtClaims } from './jwt.js';
import type { AuthProvider, Principal } from './types.js';

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/** How a person or agent supplies a new token for the source of this one. */
export function renewal(config: StaticBearerConfig): string {
  if (config.source === 'flag') return 'pipe it into --auth-token-stdin';
  if (config.variable !== undefined) return `set ${config.variable}`;
  return `set ${ENV.token} (it overrides the stored token) or store it with \`operate config set ${config.profile ?? '<profile>'} --auth-token-stdin\``;
}

/** The TOKEN_EXPIRED error of a JWT whose `exp` lies more than 30 s in the past. */
export function tokenExpired(config: StaticBearerConfig, expiresAt: number): OperateError {
  const when = `the bearer token from ${config.origin} expired at ${iso(expiresAt)}`;
  return new OperateError('TOKEN_EXPIRED', `T${when.slice(1)}`, {
    hint: `operate never refreshes bearer tokens: ${when}; fetch a new one (e.g. with your identity provider's CLI) and ${renewal(config)}.`,
  });
}

/** True once `exp` has passed (without the 30 s grace of TOKEN_EXPIRED). */
function pastExpiry(claims: Pick<JwtClaims, 'expiresAt'>, now: number): boolean {
  return claims.expiresAt !== null && now >= claims.expiresAt;
}

/**
 * `subject x, issuer y, audience a b, expires at t` of a JWT, for hints (claims, never the
 * token); `expired at t` once `exp` has passed.
 */
export function claimText(claims: JwtClaims, now: number): string {
  const expiry = pastExpiry(claims, now) ? 'expired' : 'expires';
  const parts = [
    claims.subject === null ? undefined : `subject ${claims.subject}`,
    claims.issuer === null ? undefined : `issuer ${claims.issuer}`,
    claims.audience.length === 0 ? undefined : `audience ${claims.audience.join(' ')}`,
    claims.expiresAt === null ? undefined : `${expiry} at ${iso(claims.expiresAt)}`,
  ];
  return parts.filter((part) => part !== undefined).join(', ');
}

function details(claims: JwtClaims | undefined, now: number): string {
  const text = claims === undefined ? '' : claimText(claims, now);
  return text === '' ? '' : ` (a JWT: ${text})`;
}

/**
 * What to check after a 401: for a JWT, operate knows whether `exp` has passed (a JWT is still
 * sent up to 30 s after it, for clock skew), so the hint says which cause is likely.
 */
function unauthorizedCheck(claims: JwtClaims | undefined, now: number): string {
  if (claims === undefined) {
    return 'Check that the token is still valid and was issued for this engine (or the gateway in front of it)';
  }
  if (claims.expiresAt !== null && pastExpiry(claims, now)) {
    return `It expired at ${iso(claims.expiresAt)}: operate still sends a JWT up to 30 s after its exp (clock skew), but the engine or its gateway no longer accepts it`;
  }
  return 'Check that the engine (or the gateway in front of it) expects its issuer and audience and trusts the key that signed it (operate checks no signatures)';
}

/** A token as the hints of a 401 or 403 describe it: where it came from and its claims. */
export interface RejectedToken {
  readonly origin: string;
  readonly claims: JwtClaims | undefined;
  readonly now: number;
}

/**
 * The hint of a 401 or 403 to a request with a bearer token; `next` says what to do after a 401
 * (fetch a new token, or check the token command). Undefined for other statuses.
 */
export function bearerRejectedHint(
  status: number,
  token: RejectedToken,
  next: string,
): string | undefined {
  const { origin, claims, now } = token;
  if (status === 401) {
    return `Bearer auth failed: the engine rejected the bearer token from ${origin}${details(claims, now)}. ${unauthorizedCheck(claims, now)}; ${next}`;
  }
  if (status !== 403) return undefined;
  return `The engine (or the gateway in front of it) refused the bearer token from ${origin}${details(claims, now)}: the token was accepted, but it lacks the roles or scopes this operation needs, or its user has no engine authorization for it. Request a token with the required roles or scopes (another scope or audience at the identity provider), or ask for the engine authorization.`;
}

/** The user of a JWT (preferred_username, else sub) and where the token came from. */
export function principalOf(origin: string, claims: JwtClaims | undefined): Principal | undefined {
  const user = claims?.user ?? claims?.subject ?? null;
  return user === null ? undefined : { user, source: origin };
}

export function bearerAuth(config: StaticBearerConfig, now: () => number): AuthProvider {
  const claims = jwtClaims(config.token);
  const headers = { Authorization: `Bearer ${config.token}` };
  const expiresAt = claims?.expiresAt ?? null;
  /** TOKEN_EXPIRED once `exp` lies more than 30 s in the past, else undefined. */
  const expired = () =>
    expiresAt !== null && isExpired({ expiresAt }, now())
      ? tokenExpired(config, expiresAt)
      : undefined;
  const principal = principalOf(config.origin, claims);
  const next = `fetch a new token (e.g. with your identity provider's CLI) and ${renewal(config)}. operate sends the token as it is and never refreshes it.`;
  return {
    type: 'bearer',
    headers: () => {
      const error = expired();
      return error === undefined ? Promise.resolve(headers) : Promise.reject(error);
    },
    preview: () => {
      const error = expired();
      if (error === undefined) return Promise.resolve({ headers });
      const note = `${error.message}: the request would fail with TOKEN_EXPIRED. Fetch a new one and ${renewal(config)}.`;
      return Promise.resolve({ headers, note });
    },
    ...(principal === undefined ? {} : { principal }),
    rejectedHint: (status) =>
      bearerRejectedHint(status, { origin: config.origin, claims, now: now() }, next),
  };
}
