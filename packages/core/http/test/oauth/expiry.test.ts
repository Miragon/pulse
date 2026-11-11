import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { isExpired, marginOf } from "../../src/oauth/expiry.js"
import {
  canRefresh,
  EXPIRY,
  isDue,
  refreshAt,
  renewsAfterRefusal,
  type TokenRecord,
} from "../../src/oauth/index.js"
import { omit, T0 } from "./support.js"

const lived = (seconds: number): TokenRecord => ({
  accessToken: "a",
  receivedAt: T0,
  expiresAt: T0 + seconds * 1000,
})

describe("the shared policy", () => {
  it("is a tenth of the lifetime, at most 60 s, at least 5 s, 30 s young, no assumed lifetime", () => {
    expect(EXPIRY).toEqual({
      maxMarginMs: 60_000,
      lifetimeShare: 0.1,
      floorMs: 5_000,
      youngTokenMs: 30_000,
    })
  })

  it.each([
    [3600, 60_000],
    [600, 60_000],
    [300, 30_000],
    [100, 10_000],
    [20, 5_000],
    [5, 5_000],
    [-10, 5_000],
  ])("renews a token of %i s by %i ms before it expires", (seconds, margin) => {
    expect(marginOf(seconds * 1000)).toBe(margin)
    expect(refreshAt(lived(seconds))).toBe(T0 + seconds * 1000 - margin)
  })

  it("takes the margin rule of a policy handed in", () => {
    const half = { maxMarginMs: 60_000, lifetimeShare: 0.5, floorMs: 0, youngTokenMs: 0 }
    expect(marginOf(60_000, half)).toBe(30_000)
    expect(refreshAt(lived(60), half)).toBe(T0 + 30_000)
  })

  it("never renews a token of unknown lifetime, unless the clock stands before its receipt", () => {
    const unknown = { accessToken: "a", receivedAt: T0 }
    expect(refreshAt(unknown)).toBeUndefined()
    expect(isDue(unknown, T0 + 10 ** 12)).toBe(false)
    expect(isDue(unknown, T0 - 1)).toBe(true)
  })

  it("is due from its renewal time on, and whenever the clock stands before the receipt", () => {
    const record = lived(3600)
    expect(isDue(record, T0)).toBe(false)
    expect(isDue(record, T0 + 3_539_999)).toBe(false)
    expect(isDue(record, T0 + 3_540_000)).toBe(true)
    expect(isDue(record, T0 - 1)).toBe(true)
  })

  it("never renews a token before it is due by more than its margin", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 ** 7 }), (seconds) => {
        const at = refreshAt(lived(seconds)) ?? Number.NaN
        expect(at).toBeLessThanOrEqual(T0 + seconds * 1000)
        expect(T0 + seconds * 1000 - at).toBeLessThanOrEqual(Math.max(5_000, 60_000))
      }),
    )
  })
})

describe("expiry", () => {
  it("is reached at the expiry, never for an unknown one", () => {
    expect(isExpired(lived(10), T0 + 9_999)).toBe(false)
    expect(isExpired(lived(10), T0 + 10_000)).toBe(true)
    expect(isExpired({}, T0 + 10 ** 12)).toBe(false)
  })
})

describe("after a 401", () => {
  it("renews a token of 30 s and older, and one the clock stands before", () => {
    const record = lived(3600)
    expect(renewsAfterRefusal(record, T0)).toBe(false)
    expect(renewsAfterRefusal(record, T0 + 29_999)).toBe(false)
    expect(renewsAfterRefusal(record, T0 + 30_000)).toBe(true)
    expect(renewsAfterRefusal(record, T0 - 1)).toBe(true)
    expect(renewsAfterRefusal(record, T0, { ...EXPIRY, youngTokenMs: 0 })).toBe(true)
  })
})

describe("a refresh token", () => {
  const login = { ...lived(300), refreshToken: "r", refreshExpiresAt: T0 + 1_800_000 }

  it("renews while it exists, was not refused and has not expired", () => {
    expect(canRefresh(login, T0 + 1_799_999)).toBe(true)
    expect(canRefresh(login, T0 + 1_800_000)).toBe(false)
    expect(canRefresh(omit(login, "refreshExpiresAt"), T0 + 10 ** 12)).toBe(true)
    const without = omit(login, "refreshToken")
    expect(canRefresh(without, T0)).toBe(false)
    expect(canRefresh({ ...login, refreshRejected: { at: T0, error: "invalid_grant" } }, T0)).toBe(
      false,
    )
  })
})
