import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { opaqueTokens } from "../../test/support/bearer.js"
import { PulseCliError } from "../errors.js"
import { profileAuthProblem, validateAuthType, validatePassword, validateUsername } from "./auth.js"

function failure(action: () => unknown): PulseCliError {
  try {
    action()
  } catch (error) {
    if (error instanceof PulseCliError) return error
    throw error
  }
  throw new Error("expected an PulseCliError")
}

const CONTROL_HINT =
  "Remove line breaks, tabs, NUL and other control characters; Basic auth (RFC 7617) does not allow them."

describe("validateAuthType", () => {
  it.each(["none", "basic", "bearer"] as const)("accepts %s", (type) => {
    expect(validateAuthType(type)).toBe(type)
  })

  it("names the removed oauth type and what replaces it", () => {
    const error = failure(() => validateAuthType("oauth"))
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe('The auth type "oauth" was removed')
    expect(error.details.hint).toContain("PULSE_CLI_TOKEN_COMMAND")
  })

  it.each(["OAuth", "NONE", "Basic", "", "constructor"])(
    "rejects %j and names the supported types",
    (type) => {
      const error = failure(() => validateAuthType(type))
      expect(error.code).toBe("CONFIG")
      expect(error.exitCode).toBe(3)
      expect(error.message).toBe(`Unsupported auth type "${type}"`)
      expect(error.details.hint).toBe("Supported: none, basic, bearer.")
    },
  )

  it("never repeats a value that does not look like a type name: it may be a token", () => {
    const forms = (token: string) => [token, `Bearer ${token}`, `bearer:${token}`, ` ${token}`]
    fc.assert(
      fc.property(opaqueTokens, (token) => {
        for (const value of forms(token)) {
          const error = failure(() => validateAuthType(value))
          expect(error.code).toBe("CONFIG")
          expect(error.message).toBe("Unsupported auth type (not one of none, basic, bearer)")
          expect(error.details.hint).toContain(
            "A bearer token itself goes into PULSE_CLI_TOKEN or --auth-token-stdin",
          )
          expect(`${error.message}${error.details.hint ?? ""}`).not.toContain(token)
        }
      }),
    )
    expect(failure(() => validateAuthType("a".repeat(21))).message).not.toContain("aaa")
  })
})

describe("validateUsername", () => {
  it("accepts names with spaces, non-ASCII characters and symbols", () => {
    for (const name of ["demo", "josé müller", "a@b.example", "\u{1f600}", "x=y;z"]) {
      expect(validateUsername(name, "from --auth-user")).toBe(name)
    }
  })

  it('rejects ":" (RFC 7617) without repeating the name', () => {
    const error = failure(() => validateUsername("alice:secret", "from PULSE_CLI_USERNAME"))
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe('The username (from PULSE_CLI_USERNAME) must not contain ":"')
    expect(error.details.hint).toBe(
      'Basic auth (RFC 7617) separates the username from the password with ":"; only the password may contain it.',
    )
    expect(JSON.stringify(error.details)).not.toContain("secret")
  })

  it.each(["a\nb", "a\rb", "a\0b", "a\tb", "a\u007fb", "a\u0085b", "a\u001bb"])(
    "rejects the control characters of %j",
    (name) => {
      const error = failure(() => validateUsername(name, "from --auth-user"))
      expect(error.message).toBe(
        "The username (from --auth-user) must not contain control characters",
      )
      expect(error.details.hint).toBe(CONTROL_HINT)
    },
  )

  it.each(["", "  "])("rejects the blank name %j", (name) => {
    const error = failure(() => validateUsername(name, "from --auth-user"))
    expect(error.message).toBe("The username (from --auth-user) must not be empty")
    expect(error.details.hint).toBe("Example: --auth-user demo")
  })
})

describe("validatePassword", () => {
  it('accepts ":", spaces and any non-control character', () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (value) => {
        const password = value.replace(/\p{Cc}/gu, "")
        expect(validatePassword(password, "from PULSE_CLI_PASSWORD")).toBe(password)
      }),
    )
    expect(validatePassword(" p:a ss ", "x")).toBe(" p:a ss ")
  })

  it("rejects control characters and never repeats the password", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.constantFrom("\n", "\r", "\0", "\t", "\u007f", "\u0080", "\u009f"),
        fc.string(),
        (before, control, after) => {
          const password = `${before}${control}${after}`
          const error = failure(() => validatePassword(password, "from --auth-password-stdin"))
          expect(error.message).toBe(
            "The password (from --auth-password-stdin) must not contain control characters (line breaks, NUL, tab, ...)",
          )
          expect(error.details.hint).toBe(CONTROL_HINT)
        },
      ),
    )
  })
})

describe("profileAuthProblem", () => {
  it("names a stored oauth type as removed", () => {
    expect(profileAuthProblem("p", { type: "oauth", issuer: "https://x" })).toMatch(
      /^profile "p" uses auth type "oauth", which was removed\. .*PULSE_CLI_TOKEN_COMMAND/,
    )
  })

  it("accepts the documented shapes", () => {
    for (const auth of [
      {},
      { type: "none" },
      { type: "basic", username: "demo", passwordEnv: "CAMUNDA_PASSWORD" },
      { username: "demo", password: "demo" },
      // the type is validated during resolution, with the supported types in the hint
      { type: "digest" },
    ]) {
      expect(profileAuthProblem("p", auth)).toBeUndefined()
    }
  })

  it("names the profile and the invalid key", () => {
    expect(profileAuthProblem("prod", [])).toBe(
      'profile "prod" has an invalid auth (expected {"type": "basic", "username": "demo", "passwordEnv": "CAMUNDA_PASSWORD"})',
    )
    expect(profileAuthProblem("prod", { username: "x", apiKey: "abc" })).toBe(
      'unknown key(s) apiKey in the auth of profile "prod" (allowed: type, username, passwordEnv, password, tokenEnv, token)',
    )
    expect(profileAuthProblem("prod", { username: 7 })).toBe(
      'profile "prod" has an invalid auth.username (expected a non-empty string)',
    )
    // ["PW"] reads as "PW" for a regular expression; it is still no name
    expect(profileAuthProblem("prod", { passwordEnv: ["PW"] })).toBe(
      'profile "prod" has an invalid auth.passwordEnv (expected the name of an environment variable, e.g. CAMUNDA_PASSWORD)',
    )
  })

  it("refuses password and passwordEnv together", () => {
    expect(profileAuthProblem("p", { password: "x", passwordEnv: "PW" })).toBe(
      'profile "p" sets both auth.password and auth.passwordEnv; keep one (passwordEnv is recommended)',
    )
  })

  it("never quotes a value", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 8 }).map((value) => `secret-${value}`),
        (secret) => {
          for (const auth of [
            { password: secret, passwordEnv: "PW" },
            { username: "x", password: secret, extra: secret },
            { passwordEnv: secret },
          ]) {
            expect(profileAuthProblem("p", auth) ?? "").not.toContain(secret)
          }
        },
      ),
    )
  })
})
