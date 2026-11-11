/**
 * When a token is renewed, by one policy for every surface (owner decision E3, 2026-11-08, on
 * the rule of the C8 adapter): shortly before it expires, so it never runs out in flight; after a
 * 401 only once it is old enough that a new one may help.
 */
import type { ExpiryPolicy, TokenRecord } from "./types.js"

/**
 * The shared policy: renew `min(60 s, a tenth of the lifetime)` before expiry, at least 5 s
 * before (a token of 5 s or less is renewed for every request); after a 401, renew only a token
 * at least 30 s old. It assumes no lifetime: a token whose answer names none is renewed only after
 * a 401 (client credentials assume one of their own, `clientCredentialsTokens`).
 */
export const EXPIRY: ExpiryPolicy = {
  maxMarginMs: 60_000,
  lifetimeShare: 0.1,
  floorMs: 5_000,
  youngTokenMs: 30_000,
}

/** How long before its expiry a token of `lifetimeMs` is renewed. */
export function marginOf(lifetimeMs: number, policy: ExpiryPolicy = EXPIRY): number {
  const share = Math.max(0, lifetimeMs) * policy.lifetimeShare
  return Math.max(policy.floorMs, Math.min(policy.maxMarginMs, share))
}

/**
 * When a token is due for renewal (epoch ms); undefined when it never is by this policy (its
 * expiry unknown). A client credentials token of unknown expiry is renewed all the same, 270 s
 * after its receipt: `clientCredentialsTokens` reads it as one of 300 s, which this function does
 * not know.
 */
export function refreshAt(record: TokenRecord, policy: ExpiryPolicy = EXPIRY): number | undefined {
  const { receivedAt, expiresAt } = record
  if (expiresAt === undefined) return undefined
  return expiresAt - marginOf(expiresAt - receivedAt, policy)
}

/**
 * Whether a token is due for renewal at `now`: from `refreshAt` on, and whenever the clock stands
 * before its receipt (a clock that stepped back cannot tell how old the token is); a token of
 * unknown expiry only then.
 */
export function isDue(record: TokenRecord, now: number, policy: ExpiryPolicy = EXPIRY): boolean {
  const at = refreshAt(record, policy)
  return now < record.receivedAt || (at !== undefined && now >= at)
}

/** Whether a token has expired at `now`: from `expiresAt` on, never one of unknown lifetime. */
export function isExpired(record: Pick<TokenRecord, "expiresAt">, now: number): boolean {
  return record.expiresAt !== undefined && now >= record.expiresAt
}

/**
 * Whether a token refused with a 401 at `now` is renewed: only one at least `youngTokenMs` old,
 * since a younger one was refused for another reason than its age (a wrong audience). A clock
 * that stepped back renews it.
 */
export function renewsAfterRefusal(
  record: TokenRecord,
  now: number,
  policy: ExpiryPolicy = EXPIRY,
): boolean {
  const age = now - record.receivedAt
  return age < 0 || age >= policy.youngTokenMs
}

/**
 * Whether a token can be renewed with its refresh token: there is one, the authorization server
 * did not refuse it before, and it is not known to have expired (`isExpired` over its
 * `refreshExpiresAt`). It reads those three fields only, so a surface asks it of a login in its own
 * format too.
 */
export function canRefresh<
  T extends Pick<TokenRecord, "refreshToken" | "refreshRejected" | "refreshExpiresAt">,
>(record: T, now: number): record is T & { readonly refreshToken: string } {
  const { refreshToken, refreshRejected, refreshExpiresAt } = record
  const refreshExpired = isExpired({ expiresAt: refreshExpiresAt }, now)
  return refreshToken !== undefined && refreshRejected === undefined && !refreshExpired
}
