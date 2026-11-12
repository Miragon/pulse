import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { b64tokens } from "../../test/support/bearer.js"
import { PulseCliError } from "../errors.js"
import { hasBearerKeys, normalizeToken } from "./bearer.js"

function failure(action: () => unknown): PulseCliError {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(PulseCliError)
    return error as PulseCliError
  }
  throw new Error("expected an error")
}

describe("normalizeToken", () => {
  it("keeps a valid token as it is", () => {
    expect(normalizeToken("abc.DEF-ghi_jkl~mno+pqr/stu==", "PULSE_CLI_TOKEN")).toBe(
      "abc.DEF-ghi_jkl~mno+pqr/stu==",
    )
  })

  it('drops a pasted "Bearer " prefix in any case and surrounding blanks', () => {
    fc.assert(
      fc.property(
        b64tokens,
        fc.constantFrom("", "Bearer ", "bearer ", "BEARER\t", "BeArEr   "),
        fc.constantFrom("", " ", "\t", " \n", " "),
        fc.constantFrom("", " ", "\r\n", "\t"),
        (token, prefix, before, after) => {
          expect(normalizeToken(`${before}${prefix}${token}${after}`, "PULSE_CLI_TOKEN")).toBe(
            token,
          )
        },
      ),
    )
  })

  it("is idempotent", () => {
    fc.assert(
      fc.property(b64tokens, fc.constantFrom("", "Bearer "), (token, prefix) => {
        const once = normalizeToken(`${prefix}${token}`, "x")
        expect(normalizeToken(once, "x")).toBe(once)
      }),
    )
  })

  it("keeps tokens that only start with the word bearer", () => {
    expect(normalizeToken("bearerXYZ", "x")).toBe("bearerXYZ")
    expect(normalizeToken("Bearer.abc", "x")).toBe("Bearer.abc")
  })

  it.each(["", "   ", "Bearer", "bearer ", " Bearer \t "])("refuses the empty token %j", (raw) => {
    const error = failure(() => normalizeToken(raw, "PULSE_CLI_TOKEN"))
    expect(error.code).toBe("CONFIG")
    expect(error.exitCode).toBe(3)
    expect(error.message).toBe("The bearer token from PULSE_CLI_TOKEN is empty")
    expect(error.details.hint).toBe(
      "Set the token itself, e.g. export PULSE_CLI_TOKEN=<token> or pipe it into --auth-token-stdin.",
    )
  })

  it("refuses tokens beyond the b64token syntax without repeating them", () => {
    const invalid = fc
      .tuple(
        b64tokens.filter((token) => !token.endsWith("=")),
        fc.constantFrom(" ", ":", '"', "{", "}", "ä", ",", ";", "@", "\\", "Bearer ", "=x", "%"),
        b64tokens,
      )
      .map(([head, bad, tail]) => `Secret${head}${bad}${tail}`)
    fc.assert(
      fc.property(invalid, (token) => {
        const error = failure(() => normalizeToken(token, 'auth.token of profile "p"'))
        expect(error.code).toBe("CONFIG")
        expect(error.message).toBe(
          'The bearer token from auth.token of profile "p" has characters a bearer token cannot have (RFC 6750)',
        )
        expect(`${error.message} ${error.details.hint ?? ""}`).not.toContain(token)
        expect(error.details.hint).toContain('a leading "Bearer " is fine')
      }),
    )
  })

  it("refuses padding in front and names line breaks and control characters", () => {
    expect(failure(() => normalizeToken("=abc", "x")).message).toContain("cannot have")
    for (const token of ["abc\ndef", "abc\u0000def", "abc\u007fdef"]) {
      expect(failure(() => normalizeToken(token, "--auth-token-stdin")).message).toBe(
        "The bearer token from --auth-token-stdin contains line breaks or control characters (RFC 6750)",
      )
    }
  })
})

describe("hasBearerKeys", () => {
  it("tells whether a stored auth object has a bearer token setting", () => {
    expect(hasBearerKeys(undefined)).toBe(false)
    expect(hasBearerKeys({ type: "bearer" })).toBe(false)
    expect(hasBearerKeys({ type: "none", tokenEnv: "X" })).toBe(true)
    expect(hasBearerKeys({ token: "t" })).toBe(true)
  })
})
