/**
 * The expiries of a cached login, as `pulse auth status`, the previews and the messages read
 * them. They come from the local receipt time and the relative `expires_in`
 * (@miragon/pulse-http/oauth counts them so), never from token claims or the server's clock. When
 * a token is renewed is the package's shared policy (`EXPIRY`), not this module's, and so are
 * whether a token expired (`isExpired`) and whether its refresh token can renew it
 * (`canRefresh`); this module asks those two of the cache's fields, where null stands for none.
 */

import { canRefresh as refreshable, isExpired as expired } from "@miragon/pulse-http/oauth"
import type { CachedLogin } from "./types.js"

/** When the current access token was received: the last refresh, else the login. */
export function receivedAt(login: Pick<CachedLogin, "loggedInAt" | "refreshedAt">): number {
  return login.refreshedAt ?? login.loggedInAt
}

/**
 * True from the expiry `at` on, never when it is unknown (null): the package's rule over the
 * cache's field.
 */
export function isExpired(now: number, at: number | null): boolean {
  return expired({ expiresAt: at ?? undefined }, now)
}

/**
 * True when the login has a refresh token that is not known to be expired and that the
 * authorization server has not refused before: the package's rule over the cache's fields.
 */
export function canRefresh(
  login: Pick<CachedLogin, "refreshToken" | "refreshExpiresAt" | "refreshRejected">,
  now: number,
): boolean {
  const { refreshToken, refreshExpiresAt, refreshRejected } = login
  return refreshable(
    {
      refreshToken: refreshToken ?? undefined,
      refreshExpiresAt: refreshExpiresAt ?? undefined,
      refreshRejected,
    },
    now,
  )
}
