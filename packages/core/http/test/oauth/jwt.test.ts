// Moved from the Pulse CLI (apps/cli/src/auth/jwt.test.ts) with the code it tests; the CLI's
// reading of an expired bearer token (30 s of clock skew) stays in the CLI.
import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { decodeBase64Url, jwtClaims } from "../../src/oauth/index.js"

function segment(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url")
}

const jwtWith = (claims: Readonly<Record<string, unknown>>) =>
  `${segment('{"alg":"RS256","typ":"JWT"}')}.${segment(JSON.stringify(claims))}.c2ln`

describe("decodeBase64Url", () => {
  it("decodes base64url without padding as UTF-8", () => {
    expect(decodeBase64Url(segment('{"a":"äß/+"}'))).toBe('{"a":"äß/+"}')
    // the URL alphabet's "-" and "_" stand for base64's "+" and "/"
    expect(decodeBase64Url("eyJhIjoiPz8-PyJ9")).toBe('{"a":"??>?"}')
    expect(decodeBase64Url("eyJhIjoiPz8_In0")).toBe('{"a":"???"}')
    expect(() => decodeBase64Url("_w")).toThrow()
  })
})

describe("jwtClaims", () => {
  it("reads expiry, subject, user, issuer and audience", () => {
    const claims = {
      exp: 1_700_000_300,
      sub: "user-1",
      preferred_username: "alice",
      iss: "https://login.example.com/realms/camunda",
      aud: ["engine-rest", "account"],
    }
    expect(jwtClaims(jwtWith(claims))).toEqual({
      expiresAt: 1_700_000_300_000,
      subject: "user-1",
      user: "alice",
      issuer: "https://login.example.com/realms/camunda",
      audience: ["engine-rest", "account"],
    })
  })

  it("accepts a single audience, missing claims and an unsecured JWT without signature", () => {
    const token = `${segment('{"alg":"none"}')}.${segment('{"aud":"engine-rest"}')}.`
    expect(jwtClaims(token)).toEqual({
      expiresAt: null,
      subject: null,
      user: null,
      issuer: null,
      audience: ["engine-rest"],
    })
  })

  it("ignores claims of the wrong type and cleans the ones it shows", () => {
    const claims = jwtClaims(
      jwtWith({
        exp: "1700000000",
        sub: 42,
        preferred_username: "al\u001b[31mice",
        iss: "",
        aud: ["a", 7, null, "b\u0000"],
      }),
    )
    expect(claims).toEqual({
      expiresAt: null,
      subject: null,
      user: "al[31mice",
      issuer: null,
      audience: ["a", "b"],
    })
    const long = jwtClaims(jwtWith({ sub: "x".repeat(300) }))?.subject ?? ""
    expect(long).toHaveLength(201)
    expect(long.endsWith("…")).toBe(true)
    expect(jwtClaims(jwtWith({ sub: "x".repeat(200) }))?.subject).toBe("x".repeat(200))
  })

  it("gives no expiry for an exp beyond the dates JavaScript can show", () => {
    expect(jwtClaims(jwtWith({ exp: 1e15 }))?.expiresAt).toBeNull()
    expect(jwtClaims(jwtWith({ exp: Number.POSITIVE_INFINITY }))?.expiresAt).toBeNull()
    expect(jwtClaims(jwtWith({ exp: 8.64e12 }))?.expiresAt).toBe(8.64e15)
    expect(jwtClaims(jwtWith({ exp: -8.64e12 }))?.expiresAt).toBe(-8.64e15)
  })

  it.each([
    ["an opaque token", "abc123"],
    ["two parts", `${segment("{}")}.${segment("{}")}`],
    ["five parts (JWE)", "a.b.c.d.e"],
    ["a header that is no JSON", `${segment("nope")}.${segment("{}")}.x`],
    ["a payload that is an array", `${segment("{}")}.${segment("[1]")}.x`],
    ["a payload that is null", `${segment("{}")}.${segment("null")}.x`],
    ["a payload with base64 padding", `${segment("{}")}.${segment('{"a":1}')}=.x`],
    ["a payload with full base64 padding", `${segment("{}")}.${segment('{"a":1}')}==.x`],
    [
      "a payload in standard base64 (a plus)",
      `${segment("{}")}.${Buffer.from('{"a":"??>?"}').toString("base64")}.x`,
    ],
    [
      "a payload that is not UTF-8",
      `${segment("{}")}.${Buffer.from([0xff, 0xfe]).toString("base64url")}.x`,
    ],
    ["an empty header", `.${segment("{}")}.x`],
    ["a header with a leading space", ` ${segment("{}")}.${segment("{}")}.x`],
    ["a payload with a trailing space", `${segment("{}")}.${segment("{}")} .x`],
    ["a payload that is a number", `${segment("{}")}.${segment("1")}.x`],
    ["a payload that is a string", `${segment("{}")}.${segment('"claims"')}.x`],
  ])("is undefined for %s", (_name, token) => {
    expect(jwtClaims(token)).toBeUndefined()
  })

  it("reads back the exp of any JWT (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_000_000_000 }), fc.string(), (exp, sub) => {
        const claims = jwtClaims(jwtWith({ exp, sub }))
        expect(claims?.expiresAt).toBe(exp * 1000)
        const shown = sub.replace(/\p{Cc}/gu, "")
        expect(claims?.subject).toBe(
          shown === "" ? null : shown.length > 200 ? `${shown.slice(0, 200)}…` : shown,
        )
      }),
    )
  })
})
