/**
 * The sessions signed out at this replica, each until the expiry its seal carries: a copy of the
 * session's cookie opens no session here once its user signed out, nor does the cookie a call
 * under way at the sign-out sets again. Only the ids are kept, in this replica's memory, at most
 * {@link MAX_ENDED_SESSIONS}: past that, the ones whose seal expired go, else the oldest sign-out.
 * Beside them, by their digest, the refresh tokens this replica revoked for such a session, so it
 * revokes each once (session.ts). A replica that restarts, or another replica, knows none of them:
 * the browser that signed out carries the ended cookie to every replica (cookies.ts), and a copy
 * elsewhere renews no more once the sign-out revoked its refresh token, or the first request of
 * that browser refused there revoked the one a call under way renewed after the sign-out, so its
 * access token's lifetime stays its window there.
 */

/** How many ended sessions, and how many revoked refresh tokens, a replica keeps at most. */
export const MAX_ENDED_SESSIONS = 100_000

export interface EndedSessions {
  /** Records the session `id` as ended until `until` (its seal's expiry), at `now`. */
  end(id: string, until: number, now: number): void
  /** Whether the session `id` ended at this replica and its seal has not expired by `now`. */
  has(id: string, now: number): boolean
  /**
   * Whether the refresh token of `digest` is this replica's to revoke: true the first time, which
   * records it until `until` (its session's seal expiry), false while that record holds.
   */
  revokes(digest: string, until: number, now: number): boolean
}

/** Keys, each until its expiry, at most `max`: past that, the expired ones go, else the oldest. */
function expiringKeys(max: number) {
  const keys = new Map<string, number>()
  return {
    add: (key: string, until: number, now: number): void => {
      keys.set(key, until)
      if (keys.size <= max) return
      for (const [held, expiry] of keys) if (expiry <= now) keys.delete(held)
      if (keys.size > max) keys.delete(keys.keys().next().value as string)
    },
    has: (key: string, now: number): boolean => (keys.get(key) ?? 0) > now,
  }
}

/** This replica's ended sessions and the refresh tokens it revoked, at most `max` of each. */
export function endedSessions(max = MAX_ENDED_SESSIONS): EndedSessions {
  const ended = expiringKeys(max)
  const revoked = expiringKeys(max)
  return {
    end: ended.add,
    has: ended.has,
    revokes(digest, until, now) {
      if (revoked.has(digest, now)) return false
      revoked.add(digest, until, now)
      return true
    },
  }
}
