/**
 * What `operate auth login|status|logout` print (design §16.3). Pure. Never a token: only who is
 * logged in, for what, until when, and where the cache file is. Timestamps are ISO 8601 UTC.
 */

import { iso } from "../../auth/oauth/errors.js"
import { canRefresh, isExpired } from "../../auth/oauth/expiry.js"
import type { CachedLogin } from "../../auth/oauth/types.js"
import type { OAuthConfig } from "../../config/types.js"

export interface LoginView {
  readonly profile: string | null
  /** Every profile that uses the login (design §16.5), in file order; none without a profile. */
  readonly profiles: readonly string[]
  /** The configured (and discovered) issuer. */
  readonly issuer: string | null
  readonly clientId: string
  /** `preferred_username`, else `email` of the ID token. */
  readonly user: string | null
  /** `sub` of the ID token. */
  readonly subject: string | null
  /** Granted (`scope` of the token response), else requested. */
  readonly scopes: readonly string[]
  /** null: unknown (no expires_in). */
  readonly accessTokenExpiresAt: string | null
  /** now < expiresAt (no margin); true when the expiry is unknown. */
  readonly accessTokenValid: boolean
  /** null: no refresh token, or no known expiry. */
  readonly refreshTokenExpiresAt: string | null
  /** A refresh token that is not known to be expired. */
  readonly canRefresh: boolean
  readonly loggedInAt: string
  readonly refreshedAt: string | null
  /** Absolute path of the cache file. */
  readonly tokenCache: string
}

export interface LogoutView {
  readonly profile: string | null
  /** OAuth: every profile that used the login; all of them need a new one. */
  readonly profiles?: readonly string[]
  /** The logins operate 0.7.0 and earlier cached under the profile's name, revoked and removed. */
  readonly oldTokenCaches?: readonly string[]
  readonly tokenCache: string
  readonly removed: boolean
  /** null: nothing to revoke or no revocation endpoint. */
  readonly revoked: boolean | null
}

function isoOrNull(epochMs: number | null): string | null {
  return epochMs === null ? null : iso(epochMs)
}

/** Where a login is cached and which profiles use it. */
export interface LoginUse {
  readonly tokenCache: string
  readonly profiles: readonly string[]
}

export function loginView(
  login: CachedLogin,
  config: OAuthConfig,
  use: LoginUse,
  now: number,
): LoginView {
  const granted = login.scope?.split(/\s+/).filter((scope) => scope !== "")
  return {
    profile: config.profile ?? null,
    profiles: use.profiles,
    issuer: config.issuer ?? null,
    clientId: config.clientId,
    user: login.user,
    subject: login.subject,
    scopes: granted ?? [...config.scopes],
    accessTokenExpiresAt: isoOrNull(login.expiresAt),
    accessTokenValid: !isExpired(now, login.expiresAt),
    refreshTokenExpiresAt: login.refreshToken === null ? null : isoOrNull(login.refreshExpiresAt),
    canRefresh: canRefresh(login, now),
    loggedInAt: iso(login.loggedInAt),
    refreshedAt: isoOrNull(login.refreshedAt),
    tokenCache: use.tokenCache,
  }
}

/** Rows of the table format: KEY VALUE; lists space-joined, null empty. */
export function viewRows(view: object): Record<string, unknown>[] {
  return Object.entries(view).map(([key, value]: [string, unknown]) => ({
    KEY: key,
    VALUE: Array.isArray(value) ? value.join(" ") : (value ?? ""),
  }))
}
