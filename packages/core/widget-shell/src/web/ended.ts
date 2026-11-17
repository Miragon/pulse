/**
 * The sessions signed out at this replica, each until the expiry its seal carries: a copy of the
 * session's cookie opens no session here once its user signed out, nor does the cookie a call
 * under way at the sign-out sets again. Only the ids are kept, in this replica's memory, at most
 * {@link MAX_ENDED_SESSIONS}: past that, the ones whose seal expired go, else the oldest sign-out.
 * A replica that restarts, or another replica, knows none of them: the browser that signed out
 * carries the ended cookie to every replica (cookies.ts), and a copy elsewhere renews no more once
 * the sign-out revoked its refresh token, so its access token's lifetime stays its window there.
 */

/** How many ended sessions a replica keeps at most. */
export const MAX_ENDED_SESSIONS = 100_000

export interface EndedSessions {
  /** Records the session `id` as ended until `until` (its seal's expiry), at `now`. */
  end(id: string, until: number, now: number): void
  /** Whether the session `id` ended at this replica and its seal has not expired by `now`. */
  has(id: string, now: number): boolean
}

/** This replica's ended sessions, at most `max` of them. */
export function endedSessions(max = MAX_ENDED_SESSIONS): EndedSessions {
  const ended = new Map<string, number>()
  return {
    end(id, until, now) {
      ended.set(id, until)
      if (ended.size <= max) return
      for (const [key, expiry] of ended) if (expiry <= now) ended.delete(key)
      if (ended.size > max) ended.delete(ended.keys().next().value as string)
    },
    has: (id, now) => (ended.get(id) ?? 0) > now,
  }
}
