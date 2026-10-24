/** resolveAuth precedence, authorizationConflict, resolveHeaders and Basic auth in resolveConfig. */

import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { profile } from "../../test/support/config-auth.js"
import { failure } from "../../test/support/failure.js"
import { compact } from "../util.js"
import { resolveHeaders } from "./headers.js"
import { authorizationConflict, resolveAuth } from "./resolve-auth.js"
import { resolveConfig } from "./resolve.js"
import type { Profile, ProfileAuth, Source } from "./types.js"

type Choice<T> = readonly [flag: T | undefined, env: T | undefined, profile: T | undefined]

function choice<T>(value: fc.Arbitrary<T>): fc.Arbitrary<Choice<T>> {
  const optional = fc.option(value, { nil: undefined })
  return fc.tuple(optional, optional, optional)
}

function first<T>([flag, env, stored]: Choice<T>): { value?: T; source: Source } {
  if (flag !== undefined) return { value: flag, source: "flag" }
  if (env !== undefined) return { value: env, source: "env" }
  if (stored !== undefined) return { value: stored, source: "profile" }
  return { source: "default" }
}

describe("resolveAuth precedence", () => {
  const types = choice(fc.constantFrom("none" as const, "basic" as const))
  const names = choice(fc.stringMatching(/^[a-z][a-z0-9.@-]{0,8}$/))
  // never blank: blank passwords count as unset
  const secrets = choice(
    fc.string({ unit: "binary" }).map((value) => `p${value.replace(/\p{Cc}/gu, "")}`),
  )

  type Case = readonly [
    type: Choice<"none" | "basic">,
    user: Choice<string>,
    secret: Choice<string>,
    viaVariable: boolean,
  ]

  /** Flags, environment and profile auth of a case; a stored password may sit in PW_VAR. */
  function inputs([type, user, secret, viaVariable]: Case) {
    const stored = viaVariable ? { passwordEnv: secret[2] && "PW_VAR" } : { password: secret[2] }
    return {
      flags: compact({ auth: type[0], authUser: user[0], authPassword: secret[0] }),
      env: {
        PULSE_CLI_AUTH: type[1],
        PULSE_CLI_USERNAME: user[1],
        PULSE_CLI_PASSWORD: secret[1],
        PW_VAR: viaVariable ? secret[2] : undefined,
      },
      auth: compact({ type: type[2], username: user[2], ...stored }) as ProfileAuth,
    }
  }

  const NONE_LABELS = { flag: "--auth none", env: "PULSE_CLI_AUTH=none" } as const

  /** Why auth is none: an explicit none, or a password nothing uses. */
  function off(
    explicit: { source: Source },
    [, env, stored]: Choice<string>,
    viaVariable: boolean,
  ) {
    if (explicit.source !== "default") {
      const label =
        explicit.source === "profile"
          ? 'the auth.type of profile "prod"'
          : NONE_LABELS[explicit.source]
      return `Basic auth is switched off by ${label}`
    }
    if (env !== undefined) return "a password is set (from PULSE_CLI_PASSWORD), but no username"
    if (stored === undefined) return undefined
    const key = viaVariable ? "passwordEnv" : "password"
    return `a password is set (auth.${key} of profile "prod"), but no username`
  }

  /** The expected outcome: none, the missing credentials error, or the credentials. */
  function expected([type, user, secret, viaVariable]: Case) {
    const explicit = first(type)
    const username = first(user)
    const password = first(secret)
    // without a type, a username or the password from stdin selects Basic auth
    const implied = username.value !== undefined || secret[0] !== undefined
    if (explicit.value === "none" || (explicit.value === undefined && !implied)) {
      return {
        auth: { type: "none", off: off(explicit, secret, viaVariable) },
        source: explicit.source,
      }
    }
    if (username.value === undefined || password.value === undefined) return undefined
    return {
      auth: {
        type: "basic",
        username: username.value,
        password: password.value,
        sources: { username: username.source, password: password.source },
      },
      source: explicit.value === undefined ? username.source : explicit.source,
    }
  }

  it("takes type, username and password from the highest source that sets them", () => {
    fc.assert(
      fc.property(fc.tuple(types, names, secrets, fc.boolean()), (testCase) => {
        const { flags, env, auth } = inputs(testCase)
        const run = () => resolveAuth(flags, env, profile(auth))
        const outcome = expected(testCase)
        if (outcome === undefined) {
          expect(failure(run).message).toMatch(/^Basic auth is selected but .* missing$/)
        } else {
          expect(run()).toEqual(outcome)
        }
      }),
    )
  })
})

describe("authorizationConflict", () => {
  const basic = {
    type: "basic" as const,
    username: "demo",
    password: "pw",
    sources: { username: "env" as const, password: "env" as const },
  }

  it("allows an Authorization header without Basic auth, and Basic auth without one", () => {
    expect(authorizationConflict({ type: "none" }, "flag", "p")).toBeUndefined()
    expect(authorizationConflict(basic, undefined, "p")).toBeUndefined()
  })

  it.each([
    ["flag", "given with -H/--header", "prod"],
    ["env", "from PULSE_CLI_HEADERS", "prod"],
    [
      "profile",
      'from the headers of profile "prod"; `pulse-cli config unset prod headers` removes them',
      "prod",
    ],
  ] as const)("asks to drop one when the header comes from %s", (source, origin, name) => {
    const error = authorizationConflict(basic, source, name)
    expect(error?.code).toBe("CONFIG")
    expect(error?.exitCode).toBe(3)
    expect(error?.message).toBe("Basic auth and an Authorization header are both configured")
    expect(error?.details.hint).toBe(
      `Drop one: remove the Authorization header (${origin}), or switch Basic auth off with --auth none, PULSE_CLI_AUTH=none or \`pulse-cli config unset prod auth\`.`,
    )
  })

  it("uses a placeholder without a selected profile", () => {
    expect(authorizationConflict(basic, "profile", undefined)?.details.hint).toBe(
      'Drop one: remove the Authorization header (from the headers of profile "<profile>"; `pulse-cli config unset <profile> headers` removes them), or switch Basic auth off with --auth none, PULSE_CLI_AUTH=none or `pulse-cli config unset <profile> auth`.',
    )
  })
})

describe("resolveHeaders", () => {
  it("reports the most specific source of an Authorization header", () => {
    const stored: Profile = { headers: { authorization: "Bearer p", "X-A": "1" } }
    const env = { PULSE_CLI_HEADERS: "Authorization: Bearer e" }
    expect(
      resolveHeaders({ headers: ["AUTHORIZATION: Bearer f"] }, env, stored).authorization,
    ).toBe("flag")
    expect(resolveHeaders({ headers: ["X-B: 2"] }, env, stored)).toEqual({
      value: { "X-A": "1", Authorization: "Bearer e", "X-B": "2" },
      source: "flag",
      authorization: "env",
    })
    expect(resolveHeaders({}, {}, stored).authorization).toBe("profile")
    expect(resolveHeaders({}, {}, { headers: { "X-A": "1" } })).toStrictEqual({
      value: { "X-A": "1" },
      source: "profile",
    })
    expect(resolveHeaders({}, {}, undefined)).toStrictEqual({ value: {}, source: "default" })
  })
})

describe("resolveConfig with Basic auth", () => {
  const file = (stored: Profile) => ({ defaultProfile: "p", profiles: { p: stored } })

  it("resolves Basic auth credentials", () => {
    const resolved = resolveConfig(
      { authPassword: "from-stdin" },
      { PULSE_CLI_USERNAME: "demo" },
      file({ url: "http://x" }),
    )
    expect(resolved.auth).toEqual({
      type: "basic",
      username: "demo",
      password: "from-stdin",
      sources: { username: "env", password: "flag" },
    })
    expect(resolved.sources.auth).toBe("env")
  })

  it("refuses Basic auth together with an Authorization header", () => {
    const error = failure(() =>
      resolveConfig(
        { auth: "basic", authUser: "demo", authPassword: "pw" },
        {},
        file({ headers: { Authorization: "Bearer t" } }),
      ),
    )
    expect(error.message).toBe("Basic auth and an Authorization header are both configured")
    expect(error.details.hint).toContain("`pulse-cli config unset p headers`")
    expect(
      resolveConfig({ auth: "none" }, {}, file({ headers: { Authorization: "Bearer t" } })).headers,
    ).toEqual({ Authorization: "Bearer t" })
  })

  it("checks the basic values before the credentials", () => {
    const error = failure(() => resolveConfig({ auth: "basic", url: "nope" }, {}, undefined))
    expect(error.message).toBe('Invalid engine URL "nope"')
  })
})
