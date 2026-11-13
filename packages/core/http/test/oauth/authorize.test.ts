// Moved from the Pulse CLI (apps/cli/src/auth/oauth/callback.test.ts) with the code it tests;
// the CLI's wording of a problem stays in the CLI.
import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { safeEqual } from "../../src/oauth/authorize.js"
import { authorizationUrl, callbackResult, type ExpectedCallback } from "../../src/oauth/index.js"
import { omit } from "./support.js"

const ISSUER = "https://login.example.com/realms/camunda"
const REDIRECT = "http://127.0.0.1:5000/callback"
const STATE = "S".repeat(43)
const REQUEST = {
  clientId: "pulse-cli",
  redirectUri: REDIRECT,
  scopes: ["openid", "offline_access"],
  audience: "engine-rest",
  challenge: "C".repeat(43),
  state: STATE,
}
const EXPECTED: ExpectedCallback = { state: STATE, issuer: ISSUER, issRequired: true }

describe("authorizationUrl", () => {
  it("adds the code flow parameters with PKCE S256 in a fixed order", () => {
    const url = authorizationUrl(`${ISSUER}/auth`, REQUEST)
    expect(url).toBe(
      `${ISSUER}/auth?response_type=code&client_id=pulse-cli&redirect_uri=http%3A%2F%2F127.0.0.1%3A5000%2Fcallback&scope=openid+offline_access&state=${STATE}&code_challenge=${REQUEST.challenge}&code_challenge_method=S256&audience=engine-rest`,
    )
  })

  it("keeps the query of the endpoint and leaves out empty scopes and no audience", () => {
    const bare = omit(REQUEST, "audience")
    for (const request of [
      { ...bare, scopes: [] },
      { ...bare, scopes: undefined },
    ]) {
      const url = authorizationUrl("https://as/authorize?tenant=a%20b", request as typeof bare)
      expect(url.startsWith("https://as/authorize?tenant=a%20b&response_type=code&")).toBe(true)
      expect(new URL(url).searchParams.has("scope")).toBe(false)
      expect(new URL(url).searchParams.has("audience")).toBe(false)
    }
  })
})

describe("safeEqual", () => {
  it("equals string equality", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (left, right) => {
        expect(safeEqual(left, right)).toBe(left === right)
        expect(safeEqual(left, left)).toBe(true)
      }),
    )
    expect(safeEqual("abc", "abd")).toBe(false)
    expect(safeEqual("abc", "ab")).toBe(false)
    expect(safeEqual("ä", "a")).toBe(false)
  })
})

describe("callbackResult", () => {
  const query = (value: string) => new URLSearchParams(`state=${STATE}&${value}`)

  it("takes the code of a complete callback", () => {
    expect(
      callbackResult(query(`iss=${encodeURIComponent(ISSUER)}&code=c-1&session_state=s`), EXPECTED),
    ).toEqual({ code: "c-1" })
  })

  it("ignores a callback without exactly the right state, before anything else", () => {
    for (const value of ["code=c", `state=y&code=c`, `state=${STATE}&state=${STATE}&code=c`]) {
      expect(callbackResult(new URLSearchParams(value), EXPECTED)).toEqual({ problem: "state" })
    }
    expect(callbackResult(new URLSearchParams(`state=${STATE}x`), EXPECTED)).toEqual({
      problem: "state",
    })
  })

  it("checks iss against the expected issuer (RFC 9207)", () => {
    expect(callbackResult(query("iss=https%3A%2F%2Fevil&code=c"), EXPECTED)).toEqual({
      problem: "iss",
    })
    expect(callbackResult(query("code=c"), EXPECTED)).toEqual({ problem: "iss" })
    expect(callbackResult(query(`iss=${ISSUER}&iss=${ISSUER}&code=c`), EXPECTED)).toEqual({
      problem: "iss",
    })
    const optional = { state: STATE, issuer: ISSUER }
    expect(callbackResult(query("code=c"), optional)).toEqual({ code: "c" })
    expect(callbackResult(query("iss=https%3A%2F%2Fevil&code=c"), { state: STATE })).toEqual({
      code: "c",
    })
  })

  it("reports an error with its description, a malformed code as invalid_error_code", () => {
    const optional = { state: STATE }
    expect(
      callbackResult(query("error=access_denied&error_description=User%20cancelled"), optional),
    ).toEqual({ problem: "error", error: "access_denied", description: "User cancelled" })
    expect(callbackResult(query("error=server_error"), optional)).toEqual({
      problem: "error",
      error: "server_error",
    })
    for (const malformed of ["%22bad%22", "%22bad", "bad%22", "a%5Cb"]) {
      expect(callbackResult(query(`error=${malformed}`), optional)).toEqual({
        problem: "error",
        error: "invalid_error_code",
      })
    }
  })

  it("needs exactly one non-empty code and no repeated error", () => {
    for (const value of ["", "code=", "code=a&code=b", "error=a&error=b&code=c"]) {
      expect(callbackResult(query(value), { state: STATE })).toEqual({ problem: "no-code" })
    }
  })
})
