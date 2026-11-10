import { describe, expect, it } from "vitest"
import { canRefresh, isExpired, receivedAt } from "./expiry.js"

const T0 = 1_700_000_000_000

describe("receivedAt", () => {
  it("is the last refresh, else the login", () => {
    expect(receivedAt({ loggedInAt: 1, refreshedAt: null })).toBe(1)
    expect(receivedAt({ loggedInAt: 1, refreshedAt: 5 })).toBe(5)
    expect(receivedAt({ loggedInAt: 1, refreshedAt: 0 })).toBe(0)
  })
})

describe("isExpired", () => {
  it("is true from the expiry on, never for null", () => {
    expect(isExpired(T0 - 1, T0)).toBe(false)
    expect(isExpired(T0, T0)).toBe(true)
    expect(isExpired(T0 + 1, T0)).toBe(true)
    expect(isExpired(T0, null)).toBe(false)
  })
})

describe("canRefresh", () => {
  it("needs a refresh token that is not known to be expired", () => {
    expect(canRefresh({ refreshToken: "r", refreshExpiresAt: null }, T0)).toBe(true)
    expect(canRefresh({ refreshToken: "r", refreshExpiresAt: T0 + 1 }, T0)).toBe(true)
    expect(canRefresh({ refreshToken: "r", refreshExpiresAt: T0 }, T0)).toBe(false)
    expect(canRefresh({ refreshToken: null, refreshExpiresAt: null }, T0)).toBe(false)
  })
})
