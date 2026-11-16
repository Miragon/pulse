import { describe, expect, it } from "vitest"
import { csrfRefusal, newCsrfSecret } from "./csrf.js"

const ORIGIN = "https://pulse.example.test"
const SECRET = "Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5"
const expected = { secret: SECRET, origin: ORIGIN }

const headersOf = (entries: Record<string, string>) => new Headers(entries)
const SAME_ORIGIN = { origin: ORIGIN, "sec-fetch-site": "same-origin", "x-pulse-csrf": SECRET }
/** The same-origin request's headers without one of them. */
const without = (name: keyof typeof SAME_ORIGIN) => {
  const headers = headersOf(SAME_ORIGIN)
  headers.delete(name)
  return headers
}

describe("csrfRefusal", () => {
  it("lets a page of the app's own origin through with the session's token", () => {
    expect(csrfRefusal(headersOf(SAME_ORIGIN), expected)).toBeUndefined()
  })

  it("lets a browser through that sends no Sec-Fetch-Site", () => {
    expect(csrfRefusal(without("sec-fetch-site"), expected)).toBeUndefined()
  })

  it("refuses a request the browser reports as coming from elsewhere", () => {
    for (const site of ["cross-site", "same-site", "none", ""]) {
      const headers = headersOf({ ...SAME_ORIGIN, "sec-fetch-site": site })
      expect(csrfRefusal(headers, expected), site).toBe("cross-site")
    }
  })

  it("refuses a foreign, missing or opaque Origin", () => {
    for (const origin of [
      "https://evil.example",
      "http://pulse.example.test",
      "https://pulse.example.test:8443",
      "https://sub.pulse.example.test",
      "null",
      "",
    ]) {
      const headers = headersOf({ ...SAME_ORIGIN, origin })
      expect(csrfRefusal(headers, expected), origin).toBe("origin")
    }
    expect(csrfRefusal(without("origin"), expected)).toBe("origin")
  })

  it("refuses a request without the token", () => {
    expect(csrfRefusal(without("x-pulse-csrf"), expected)).toBe("no-token")
    expect(csrfRefusal(headersOf({ ...SAME_ORIGIN, "x-pulse-csrf": "" }), expected)).toBe(
      "no-token",
    )
    expect(
      csrfRefusal(headersOf({ ...SAME_ORIGIN, "x-pulse-csrf": "" }), { ...expected, secret: "" }),
    ).toBe("no-token")
  })

  it("refuses a wrong token, also one that only starts like the secret", () => {
    for (const token of ["wrong", SECRET.slice(0, -1), `${SECRET}x`, SECRET.toLowerCase()]) {
      const headers = headersOf({ ...SAME_ORIGIN, "x-pulse-csrf": token })
      expect(csrfRefusal(headers, expected), token).toBe("wrong-token")
    }
  })

  it("compares the token with this session's secret", () => {
    expect(csrfRefusal(headersOf(SAME_ORIGIN), { ...expected, secret: newCsrfSecret() })).toBe(
      "wrong-token",
    )
  })
})

describe("newCsrfSecret", () => {
  it("draws 32 random bytes in base64url, a new one each time", () => {
    const secrets = new Set(Array.from({ length: 50 }, newCsrfSecret))
    expect(secrets.size).toBe(50)
    for (const secret of secrets) {
      expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(Buffer.from(secret, "base64url")).toHaveLength(32)
    }
  })
})
