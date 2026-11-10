/**
 * Token expiry math. Expiries come from the local receipt time and the relative `expires_in`
 * (@miragon/pulse-http/oauth counts them so), never from token claims or the server's clock. A
 * token is refreshed shortly before it expires: the margin is 60 s, but at most half the token's
 * lifetime, so short-lived tokens (Keycloak realms with 60 s or 5 s) are not refreshed on every
 * request.
 */

import type { CachedLogin } from "./types.js"

export const REFRESH_MARGIN_MS = 60_000

/** When the current access token was received: the last refresh, else the login. */
export function receivedAt(login: Pick<CachedLogin, "loggedInAt" | "refreshedAt">): number {
  return login.refreshedAt ?? login.loggedInAt
}

/** min(60 s, lifetime / 2); a non-positive lifetime has no margin. */
export function refreshMargin(expiresAt: number, received: number): number {
  return Math.min(REFRESH_MARGIN_MS, Math.max(0, expiresAt - received) / 2)
}

/** True once the access token is within its refresh margin (never for an unknown expiry). */
export function needsRefresh(
  now: number,
  login: Pick<CachedLogin, "expiresAt" | "loggedInAt" | "refreshedAt">,
): boolean {
  const { expiresAt } = login
  return expiresAt !== null && now >= expiresAt - refreshMargin(expiresAt, receivedAt(login))
}

export function isExpired(now: number, at: number | null): boolean {
  return at !== null && now >= at
}

/**
 * True when the login has a refresh token that is not known to be expired and that the
 * authorization server has not refused before.
 */
export function canRefresh(
  login: Pick<CachedLogin, "refreshToken" | "refreshExpiresAt" | "refreshRejected">,
  now: number,
): boolean {
  return (
    login.refreshToken !== null &&
    login.refreshRejected === undefined &&
    !isExpired(now, login.refreshExpiresAt)
  )
}
