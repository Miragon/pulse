import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { opaqueTokens } from "../../test/support/bearer.js"
import { OperateError } from "../errors.js"
import {
  checkVariableName,
  checkVariableNames,
  CLIENT_SECRET_VARIABLE,
  isConventionalVariable,
  PASSWORD_VARIABLE,
  type SecretVariable,
  TOKEN_VARIABLE,
  unsetVariable,
  unsetVariableWarnings,
  validateVariableName,
} from "./variable.js"

function failure(action: () => unknown): OperateError {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(OperateError)
    expect((error as OperateError).code).toBe("CONFIG")
    return error as OperateError
  }
  throw new Error("expected an error")
}

function text(error: OperateError): string {
  return `${error.message}\n${error.details.hint ?? ""}`
}

const KINDS: readonly SecretVariable[] = [PASSWORD_VARIABLE, CLIENT_SECRET_VARIABLE, TOKEN_VARIABLE]

/**
 * Secrets that are valid variable names but not in the usual form: lower case letters, long
 * random words (opaque tokens without the characters a name cannot have), `ghp_...`.
 */
const unusualNames = fc
  .oneof(
    fc.stringMatching(/^[A-Za-z0-9_]{4,38}$/).map((value) => `zq${value}`),
    fc.stringMatching(/^[A-Z][A-Z0-9]{24,40}$/),
    opaqueTokens.filter((token) => /^[A-Za-z0-9_]+$/.test(token)),
    fc.stringMatching(/^[A-Za-z0-9]{20,36}$/).map((value) => `ghp_${value}`),
  )
  .filter((name) => !isConventionalVariable(name))

describe("validateVariableName", () => {
  it.each(KINDS)("accepts and trims variable names ($flag)", (variable) => {
    for (const name of ["CAMUNDA_PASSWORD", "_x", "a1", " PW "]) {
      expect(validateVariableName(name, variable)).toBe(name.trim())
    }
  })

  it("names the option, an example and what the variable holds", () => {
    const hints = KINDS.map((variable) => failure(() => validateVariableName("1PW", variable)))
    expect(hints.map((error) => [error.message, error.details.hint])).toEqual([
      [
        "Invalid --auth-password-env: expected the name of an environment variable",
        'Use letters, digits and "_", not starting with a digit, e.g. --auth-password-env CAMUNDA_PASSWORD; the variable holds the password.',
      ],
      [
        "Invalid --oauth-client-secret-env: expected the name of an environment variable",
        'Use letters, digits and "_", not starting with a digit, e.g. --oauth-client-secret-env OPERATE_CLIENT_SECRET; the variable holds the client secret.',
      ],
      [
        "Invalid --auth-token-env: expected the name of an environment variable",
        'Use letters, digits and "_", not starting with a digit, e.g. --auth-token-env CI_ENGINE_TOKEN; the variable holds the token.',
      ],
    ])
  })

  it.each(["", "1ABC", "MY-VAR", "p@ss w0rd!", "A.B", "eyJhbGciOi.payload.sig", "s3cr3t-value!"])(
    "refuses %j without repeating it (it may be the secret)",
    (name) => {
      for (const variable of KINDS) {
        const error = failure(() => validateVariableName(name, variable))
        expect(error.message).toBe(
          `Invalid ${variable.flag}: expected the name of an environment variable`,
        )
        if (name !== "") expect(text(error)).not.toContain(name)
      }
    },
  )
})

describe("isConventionalVariable", () => {
  it("accepts upper-case names of words up to 24 characters, at most 64 in all", () => {
    for (const name of ["CI_ENGINE_TOKEN", "_X", "A", "OPERATE_ENGINE_PRODUCTION_BEARER_TOKEN"]) {
      expect(isConventionalVariable(name)).toBe(true)
    }
    expect(isConventionalVariable(`${"A".repeat(24)}_B`)).toBe(true)
    expect(isConventionalVariable(`A${"_B".repeat(31)}`)).toBe(true)
  })

  it("refuses lower case, long words and long names: opaque tokens look like that", () => {
    for (const name of [
      "tok_SECRETabcdefghijklmnopqrstuvwxyz0123",
      "ci_token",
      "hunter2",
      "A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6",
      "A".repeat(25),
      `A_${"B".repeat(25)}`,
      `A${"_B".repeat(32)}`,
      Array.from({ length: 14 }, () => "ABCD").join("_"),
      "1ABC",
      "",
    ]) {
      expect(isConventionalVariable(name)).toBe(false)
    }
  })
})

describe("checkVariableName", () => {
  it.each(KINDS)(
    "accepts a set variable in any form and an unset one in the usual form ($flag)",
    (variable) => {
      expect(checkVariableName(" CI_ENGINE_TOKEN ", {}, variable)).toBe("CI_ENGINE_TOKEN")
      expect(checkVariableName("ci_token", { ci_token: "v" }, variable)).toBe("ci_token")
      expect(checkVariableName(" pw_value ", { pw_value: " v " }, variable)).toBe("pw_value")
    },
  )

  it("refuses an unset name in another form without repeating it: it may be the secret", () => {
    fc.assert(
      fc.property(unusualNames, fc.constantFrom(...KINDS), (name, variable) => {
        const upper = name.toUpperCase()
        const envs = [{}, { [name]: " " }, ...(upper === name ? [] : [{ [upper]: "other" }])]
        for (const env of envs) {
          const error = failure(() => checkVariableName(name, env, variable))
          expect(error.message).toBe(
            `${variable.flag} names a variable that is not set and does not look like a variable name: it may be the ${variable.noun} itself, so it is neither stored nor repeated`,
          )
          expect(text(error)).not.toContain(name)
        }
      }),
    )
  })

  it("says how to pass the name instead of the value", () => {
    expect(failure(() => checkVariableName("hunter2", {}, PASSWORD_VARIABLE)).details.hint).toBe(
      'Pass the name of the variable that holds the password, not its value: --auth-password-env CAMUNDA_PASSWORD, not --auth-password-env "$CAMUNDA_PASSWORD". A name in another form (lower case, very long) is accepted once the variable is set.',
    )
    expect(failure(() => checkVariableName("ghp_x1", {}, TOKEN_VARIABLE)).message).toBe(
      "--auth-token-env names a variable that is not set and does not look like a variable name: it may be the token itself, so it is neither stored nor repeated",
    )
    expect(
      failure(() => checkVariableName("cs_value", {}, CLIENT_SECRET_VARIABLE)).details.hint,
    ).toBe(
      'Pass the name of the variable that holds the client secret, not its value: --oauth-client-secret-env OPERATE_CLIENT_SECRET, not --oauth-client-secret-env "$OPERATE_CLIENT_SECRET". A name in another form (lower case, very long) is accepted once the variable is set.',
    )
  })

  it("checks the syntax first", () => {
    expect(failure(() => checkVariableName("a.b.c", {}, TOKEN_VARIABLE)).message).toBe(
      "Invalid --auth-token-env: expected the name of an environment variable",
    )
  })
})

describe("checkVariableNames", () => {
  it("checks each --*-env option of config set", () => {
    expect(() => {
      checkVariableNames({}, {})
    }).not.toThrow()
    expect(() => {
      checkVariableNames(
        { authPasswordEnv: "PW", oauthClientSecretEnv: "SECRET", authTokenEnv: "TOKEN" },
        {},
      )
    }).not.toThrow()
    const options = [
      ["authPasswordEnv", PASSWORD_VARIABLE],
      ["oauthClientSecretEnv", CLIENT_SECRET_VARIABLE],
      ["authTokenEnv", TOKEN_VARIABLE],
    ] as const
    for (const [option, variable] of options) {
      const error = failure(() => {
        checkVariableNames({ [option]: "secret_value_1" }, {})
      })
      expect(error.message).toContain(`${variable.flag} names a variable that is not set`)
      expect(() => {
        checkVariableNames({ [option]: "secret_value_1" }, { secret_value_1: "x" })
      }).not.toThrow()
    }
  })
})

describe("unsetVariableWarnings", () => {
  it("warns about each stored name that is not set, without naming it", () => {
    const names = { authPasswordEnv: " PW ", oauthClientSecretEnv: "SECRET", authTokenEnv: "TOK" }
    expect(unsetVariableWarnings(names, { SECRET: " " })).toEqual([
      "Warning: the variable named by --auth-password-env is not set in this environment. Pass the name of a variable that holds the password (e.g. CAMUNDA_PASSWORD), never the password itself; commands read it when they run.",
      "Warning: the variable named by --oauth-client-secret-env is not set in this environment. Pass the name of a variable that holds the client secret (e.g. OPERATE_CLIENT_SECRET), never the client secret itself; commands read it when they run.",
      "Warning: the variable named by --auth-token-env is not set in this environment. Pass the name of a variable that holds the token (e.g. CI_ENGINE_TOKEN), never the token itself; commands read it when they run.",
    ])
    expect(unsetVariableWarnings(names, { PW: "p", SECRET: "s", TOK: "t" })).toEqual([])
    expect(unsetVariableWarnings({}, {})).toEqual([])
  })
})

describe("unsetVariable", () => {
  it("names a variable in the usual form and how to fix it", () => {
    const errors = KINDS.map((variable) => unsetVariable("CI_VALUE", "prod", variable))
    expect(errors.map((error) => [error.code, error.message, error.details.hint])).toEqual([
      [
        "CONFIG",
        'The password variable CI_VALUE (auth.passwordEnv of profile "prod") is not set or empty',
        "Export it, e.g. export CI_VALUE=<password>, or name another variable with `operate config set prod --auth-password-env <VAR>`.",
      ],
      [
        "CONFIG",
        'The client secret variable CI_VALUE (auth.clientSecretEnv of profile "prod") is not set or empty',
        "Export it, e.g. export CI_VALUE=<secret>, or name another variable with `operate config set prod --oauth-client-secret-env <VAR>`.",
      ],
      [
        "CONFIG",
        'The token variable CI_VALUE (auth.tokenEnv of profile "prod") is not set or empty',
        "Export it, e.g. export CI_VALUE=<token>, or name another variable with `operate config set prod --auth-token-env <VAR>`.",
      ],
    ])
  })

  it("does not repeat a name in another form: it may be the secret stored by mistake", () => {
    expect(text(unsetVariable("hunter2", "p", PASSWORD_VARIABLE))).toBe(
      'The password variable named by auth.passwordEnv of profile "p" is not set or empty\nIts name is not in the usual upper-case form, so it is not repeated: it may be a password stored by mistake. Check auth.passwordEnv in the config file (`operate config path`), or name another variable with `operate config set p --auth-password-env <VAR>`.',
    )
    fc.assert(
      fc.property(unusualNames, fc.constantFrom(...KINDS), (name, variable) => {
        const error = unsetVariable(name, "p", variable)
        expect(error.message).toBe(
          `The ${variable.noun} variable named by auth.${variable.key} of profile "p" is not set or empty`,
        )
        expect(text(error)).not.toContain(name)
      }),
    )
  })
})
