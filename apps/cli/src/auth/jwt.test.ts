import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { jwtWith } from "../../test/support/bearer.js"
import { EXPIRY_SKEW_MS, isExpired, jwtClaims } from "./jwt.js"

// jwtClaims moved to @miragon/pulse-http/oauth with its tests (test/oauth/jwt.test.ts there);
// the CLI keeps when a bearer token counts as expired.

describe("isExpired", () => {
  it("allows 30 s of clock skew: expired only more than 30 s after exp", () => {
    const expiresAt = 1_700_000_000_000
    expect(EXPIRY_SKEW_MS).toBe(30_000)
    expect(isExpired({ expiresAt }, expiresAt)).toBe(false)
    expect(isExpired({ expiresAt }, expiresAt + 30_000)).toBe(false)
    expect(isExpired({ expiresAt }, expiresAt + 30_001)).toBe(true)
    expect(isExpired({ expiresAt: null }, Number.MAX_SAFE_INTEGER)).toBe(false)
  })

  it("is false up to exp + 30 s and true after it, monotone in time (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4_000_000_000 }),
        fc.integer({ min: -10_000_000, max: 10_000_000 }),
        fc.nat(10_000_000),
        (exp, offset, later) => {
          const expiresAt = exp * 1000
          const now = expiresAt + offset
          expect(isExpired({ expiresAt }, now)).toBe(offset > EXPIRY_SKEW_MS)
          if (isExpired({ expiresAt }, now))
            expect(isExpired({ expiresAt }, now + later)).toBe(true)
        },
      ),
    )
  })

  it("agrees with the claims of a JWT at the boundary (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_000_000_000 }), (exp) => {
        const claims = jwtClaims(jwtWith({ exp }))
        expect(claims).toBeDefined()
        if (claims === undefined) return
        expect(isExpired(claims, exp * 1000 + EXPIRY_SKEW_MS)).toBe(false)
        expect(isExpired(claims, exp * 1000 + EXPIRY_SKEW_MS + 1)).toBe(true)
      }),
    )
  })
})
