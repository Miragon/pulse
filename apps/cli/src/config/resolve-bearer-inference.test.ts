/** resolveAuth infers the bearer type from the token settings (resolve-auth.ts). */

import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { NO_PROFILE, profile } from "../../test/support/config-auth.js"
import { failure } from "../../test/support/failure.js"
import { compact } from "../util.js"
import { resolveAuth, selectedAuth } from "./resolve-auth.js"
import type { AuthType, ConfigFlags, ProfileAuth } from "./types.js"

describe("resolveAuth type inference with bearer tokens", () => {
  it("selects bearer auth for a token of OPERATE_TOKEN or --auth-token-stdin without a type", () => {
    expect(resolveAuth({}, { OPERATE_TOKEN: "t" }, NO_PROFILE)).toMatchObject({
      auth: { type: "bearer", origin: "OPERATE_TOKEN" },
      source: "env",
    })
    expect(resolveAuth({ authToken: "t" }, {}, NO_PROFILE)).toMatchObject({
      auth: { type: "bearer", origin: "--auth-token-stdin" },
      source: "flag",
    })
  })

  it("refuses a username and a token without a type", () => {
    const error = failure(() =>
      resolveAuth({}, { OPERATE_USERNAME: "demo", OPERATE_TOKEN: "t" }, NO_PROFILE),
    )
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe(
      "Both Basic auth and a bearer token are configured, but no auth type says which one to use",
    )
    expect(error.details.hint).toBe(
      "A username (from OPERATE_USERNAME) selects Basic auth, a bearer token (from OPERATE_TOKEN) selects bearer auth. Choose one explicitly: --auth basic or --auth bearer (also OPERATE_AUTH or the auth.type of the profile), or unset the other.",
    )
    const stdin = failure(() => resolveAuth({ authPassword: "pw", authToken: "t" }, {}, NO_PROFILE))
    expect(stdin.details.hint).toContain(
      "--auth-password-stdin selects Basic auth, a bearer token (from --auth-token-stdin) selects bearer auth.",
    )
    const stored = failure(() =>
      resolveAuth({}, { OPERATE_TOKEN: "t" }, profile({ username: "demo" })),
    )
    expect(stored.details.hint).toContain('A username (auth.username of profile "prod")')
  })

  it("lets an explicit type win and reports the unused token", () => {
    const env = { OPERATE_USERNAME: "demo", OPERATE_PASSWORD: "pw", OPERATE_TOKEN: "tok" }
    expect(resolveAuth({ auth: "basic" }, env, NO_PROFILE)).toMatchObject({
      auth: { type: "basic", username: "demo" },
      unusedToken: {
        value: "tok",
        source: "env",
        reason: "Basic auth is selected by --auth basic",
      },
    })
    expect(resolveAuth({}, { ...env, OPERATE_AUTH: "none" }, NO_PROFILE)).toEqual({
      auth: { type: "none", off: "Bearer auth is switched off by OPERATE_AUTH=none" },
      source: "env",
      unusedToken: {
        value: "tok",
        source: "env",
        reason: "bearer auth is switched off by OPERATE_AUTH=none",
      },
    })
    const oauth = {
      OPERATE_TOKEN: "tok",
      OPERATE_OAUTH_ISSUER: "https://login.example.com/realms/x",
      OPERATE_OAUTH_CLIENT_ID: "cli",
    }
    expect(resolveAuth({}, oauth, profile({ type: "oauth" }))).toMatchObject({
      auth: { type: "oauth" },
      unusedToken: { reason: 'OAuth is selected by the auth.type of profile "prod"' },
    })
  })

  it("says in a resolution error that a token is set but not used, and how to send it", () => {
    const basic = failure(() =>
      resolveAuth(
        {},
        { OPERATE_TOKEN: "tok" },
        profile({ type: "basic", username: "u", passwordEnv: "UNSET_PASSWORD" }),
      ),
    )
    expect(basic.message).toBe(
      'The password variable UNSET_PASSWORD (auth.passwordEnv of profile "prod") is not set or empty',
    )
    expect(basic.details.hint).toBe(
      'Export it, e.g. export UNSET_PASSWORD=<password>, or name another variable with `operate config set prod --auth-password-env <VAR>`. A bearer token is set (from OPERATE_TOKEN) but not used: Basic auth is selected by the auth.type of profile "prod"; send it with --auth bearer or OPERATE_AUTH=bearer.',
    )
    // errors without a hint get the note as hint
    const scopes = failure(() =>
      resolveAuth(
        { auth: "oauth" },
        {
          OPERATE_TOKEN: "tok",
          OPERATE_OAUTH_ISSUER: "https://login.example.com/realms/x",
          OPERATE_OAUTH_CLIENT_ID: "cli",
          OPERATE_OAUTH_SCOPES: "openid openid",
        },
        NO_PROFILE,
      ),
    )
    expect(scopes.details.hint).toBe(
      "A bearer token is set (from OPERATE_TOKEN) but not used: OAuth is selected by --auth oauth; send it with --auth bearer or OPERATE_AUTH=bearer.",
    )
    // auth commands have no --auth option
    const status = failure(() =>
      resolveAuth(
        {},
        { OPERATE_TOKEN: "tok" },
        profile({ type: "basic", username: "u", passwordEnv: "UNSET_PASSWORD" }),
        true,
      ),
    )
    expect(status.details.hint).toContain(
      'A bearer token is set (from OPERATE_TOKEN) but not used: Basic auth is selected by the auth.type of profile "prod"; use it with OPERATE_AUTH=bearer.',
    )
    // without an unused token the error stays as it is
    const plain = failure(() =>
      resolveAuth({}, {}, profile({ type: "basic", username: "u", passwordEnv: "UNSET" })),
    )
    expect(plain.details.hint).not.toContain("bearer")
  })

  it("never leaves --auth-token-stdin unused next to Basic auth or OAuth", () => {
    for (const type of ["basic", "oauth"]) {
      const error = failure(() =>
        resolveAuth({ auth: type, authToken: "t" }, { OPERATE_USERNAME: "u" }, NO_PROFILE),
      )
      expect(error.code).toBe("CONFIG")
      expect(error.message).toBe(
        `--auth-token-stdin reads a bearer token, but ${type === "basic" ? "Basic auth" : "OAuth"} is selected by --auth ${type}`,
      )
      expect(error.details.hint).toBe(
        "Drop --auth-token-stdin, or select bearer auth with --auth bearer.",
      )
    }
    // auth commands have no --auth option: the hint names the variable
    const auth = failure(() =>
      resolveAuth({ authToken: "t" }, {}, profile({ type: "oauth", clientId: "c" }), true),
    )
    expect(auth.details.hint).toBe(
      "Drop --auth-token-stdin, or select bearer auth with OPERATE_AUTH=bearer.",
    )
    // switched off: the token is reported, not refused
    expect(resolveAuth({ auth: "none", authToken: "t" }, {}, NO_PROFILE).unusedToken).toEqual({
      value: "t",
      source: "flag",
      reason: "bearer auth is switched off by --auth none",
    })
  })

  it("names bearer auth when an explicit none switches off a stored token", () => {
    expect(resolveAuth({}, {}, profile({ type: "none", tokenEnv: "UNSET" }))).toEqual({
      auth: { type: "none", off: 'Bearer auth is switched off by the auth.type of profile "prod"' },
      source: "profile",
    })
  })

  type Origin = "flag" | "env" | "profile"
  interface Setup {
    readonly type: { readonly value: AuthType; readonly origin: Origin } | undefined
    readonly username: Origin | undefined
    readonly passwordStdin: boolean
    readonly token: "flag" | "env" | undefined
  }

  const USERS: Readonly<Record<Origin, string>> = { flag: "u1", env: "u2", profile: "u3" }

  function inputs(setup: Setup) {
    const type = (origin: Origin) => (setup.type?.origin === origin ? setup.type.value : undefined)
    const user = (origin: Origin) => (setup.username === origin ? USERS[origin] : undefined)
    const token = (origin: "flag" | "env") => (setup.token === origin ? `tok.${origin}` : undefined)
    const flags: ConfigFlags = compact({
      auth: type("flag"),
      authUser: user("flag"),
      authPassword: setup.passwordStdin ? "pw" : undefined,
      authToken: token("flag"),
    })
    const env = compact({
      OPERATE_AUTH: type("env"),
      OPERATE_USERNAME: user("env"),
      OPERATE_TOKEN: token("env"),
      OPERATE_PASSWORD: "envpw",
      OPERATE_OAUTH_ISSUER: "https://login.example.com/realms/x",
      OPERATE_OAUTH_CLIENT_ID: "cli",
    })
    const auth: ProfileAuth = compact({ type: type("profile"), username: user("profile") })
    return { flags, env, selected: profile(auth) }
  }

  /** Types that read no bearer token, and types that read no Basic auth password. */
  const NO_TOKEN: ReadonlySet<AuthType> = new Set(["basic", "oauth"])
  const NO_PASSWORD: ReadonlySet<AuthType> = new Set(["bearer", "oauth"])
  const MISSING_USERNAME = { error: "Basic auth is selected but the username is missing" }

  /** The outcome with an explicit type: it wins, but stdin is never read for nothing. */
  function explicitOutcome(value: AuthType, setup: Setup): AuthType | { error: string } {
    if (setup.token === "flag" && NO_TOKEN.has(value)) {
      return { error: "--auth-token-stdin reads a bearer token" }
    }
    if (setup.passwordStdin && NO_PASSWORD.has(value)) {
      return { error: "--auth-password-stdin reads a Basic auth password" }
    }
    if (value === "basic" && setup.username === undefined) return MISSING_USERNAME
    return value === "bearer" && setup.token === undefined
      ? { error: "Bearer auth is selected but the token is missing" }
      : value
  }

  /** The type resolution must pick, or the start of the CONFIG error it must raise. */
  function oracle(setup: Setup): AuthType | { error: string } {
    const { type, username, passwordStdin, token } = setup
    if (type !== undefined) return explicitOutcome(type.value, setup)
    const basic = username !== undefined || passwordStdin
    if (token !== undefined)
      return basic ? { error: "Both Basic auth and a bearer token" } : "bearer"
    if (!basic) return "none"
    return username === undefined ? MISSING_USERNAME : "basic"
  }

  it("picks the type by explicit type, then username or token, never both (property)", () => {
    const origins = fc.constantFrom<Origin>("flag", "env", "profile")
    const setups = fc.record({
      type: fc.option(
        fc.record({
          value: fc.constantFrom<AuthType>("none", "basic", "oauth", "bearer"),
          origin: origins,
        }),
        { nil: undefined },
      ),
      username: fc.option(origins, { nil: undefined }),
      passwordStdin: fc.boolean(),
      token: fc.constantFrom<"flag" | "env" | undefined>("flag", "env", undefined),
    })
    fc.assert(
      fc.property(setups, (setup) => {
        const { flags, env, selected } = inputs(setup)
        const expected = oracle(setup)
        if (typeof expected === "string") {
          const resolved = resolveAuth(flags, env, selected)
          expect(resolved.auth.type).toBe(expected)
          const unused = setup.token !== undefined && expected !== "bearer"
          expect(resolved.unusedToken !== undefined).toBe(unused)
          expect(selectedAuth(flags, env, selected)).toMatchObject({
            type: expected,
            source: resolved.source,
          })
        } else {
          const error = failure(() => resolveAuth(flags, env, selected))
          expect(error.code).toBe("CONFIG")
          expect(error.message.startsWith(expected.error)).toBe(true)
        }
      }),
      { numRuns: 300 },
    )
  })
})
