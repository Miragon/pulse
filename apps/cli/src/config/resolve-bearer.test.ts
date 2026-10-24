import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { b64tokens } from "../../test/support/bearer.js"
import { OperateError } from "../errors.js"
import { compact } from "../util.js"
import { resolveHeaders } from "./headers.js"
import { authorizationConflict, resolveAuth, selectedAuth } from "./resolve-auth.js"
import { resolveConfig } from "./resolve.js"
import type { AuthType, ConfigFlags, ProfileAuth, SelectedProfile } from "./types.js"

function failure(action: () => unknown): OperateError {
  try {
    action()
  } catch (error) {
    if (error instanceof OperateError) return error
    throw error
  }
  throw new Error("expected an OperateError")
}

function profile(auth: ProfileAuth, name = "prod"): SelectedProfile {
  return { name, profile: { auth } }
}

const NO_PROFILE: SelectedProfile = {}

describe("resolveAuth with a bearer token", () => {
  it("sends the token of OPERATE_TOKEN with --auth bearer", () => {
    expect(resolveAuth({ auth: "bearer" }, { OPERATE_TOKEN: "abc.def" }, NO_PROFILE)).toEqual({
      auth: {
        type: "bearer",
        token: "abc.def",
        source: "env",
        origin: "OPERATE_TOKEN",
        variable: "OPERATE_TOKEN",
      },
      source: "flag",
    })
  })

  it('normalizes the token: a pasted "Bearer " and blanks go', () => {
    const resolved = resolveAuth({}, { OPERATE_TOKEN: "  Bearer abc.def== \n" }, NO_PROFILE)
    expect(resolved.auth).toMatchObject({ type: "bearer", token: "abc.def==" })
  })

  it("reads the token of --auth-token-stdin first", () => {
    const resolved = resolveAuth(
      { authToken: "from-stdin" },
      { OPERATE_TOKEN: "from-env", OPERATE_AUTH: "bearer" },
      profile({ type: "bearer", token: "stored" }),
    )
    expect(resolved).toEqual({
      auth: {
        type: "bearer",
        token: "from-stdin",
        source: "flag",
        origin: "--auth-token-stdin",
        profile: "prod",
      },
      source: "env",
    })
  })

  it("reads the variable named by auth.tokenEnv only without a higher source", () => {
    const stored = profile({ type: "bearer", tokenEnv: "CI_TOKEN" })
    expect(resolveAuth({}, { CI_TOKEN: "ci.token" }, stored)).toEqual({
      auth: {
        type: "bearer",
        token: "ci.token",
        source: "profile",
        origin: 'CI_TOKEN (auth.tokenEnv of profile "prod")',
        variable: "CI_TOKEN",
        profile: "prod",
      },
      source: "profile",
    })
    // the unset variable does not matter when OPERATE_TOKEN has a token
    expect(resolveAuth({}, { OPERATE_TOKEN: "env.token" }, stored).auth).toMatchObject({
      token: "env.token",
      source: "env",
    })
  })

  it("names an unset token variable, never a value", () => {
    for (const value of [undefined, "", "  "]) {
      const error = failure(() =>
        resolveAuth(
          {},
          compact({ CI_TOKEN: value }),
          profile({ type: "bearer", tokenEnv: "CI_TOKEN" }),
        ),
      )
      expect(error.code).toBe("CONFIG")
      expect(error.message).toBe(
        'The token variable CI_TOKEN (auth.tokenEnv of profile "prod") is not set or empty',
      )
      expect(error.details.hint).toBe(
        "Export it, e.g. export CI_TOKEN=<token>, or name another variable with `operate config set prod --auth-token-env <VAR>`.",
      )
    }
  })

  it("does not repeat an unset token variable whose name may be the token itself", () => {
    const name = "tok_SECRETabcdefghijklmnopqrstuvwxyz0123"
    const error = failure(() => resolveAuth({}, {}, profile({ type: "bearer", tokenEnv: name })))
    expect(error.message).toBe(
      'The token variable named by auth.tokenEnv of profile "prod" is not set or empty',
    )
    expect(error.details.hint).toBe(
      "Its name is not in the usual upper-case form, so it is not repeated: it may be a token stored by mistake. Check auth.tokenEnv in the config file (`operate config path`), or name another variable with `operate config set prod --auth-token-env <VAR>`.",
    )
    // set, it is a variable: the token is read from it
    const set = resolveAuth({}, { [name]: "tok" }, profile({ type: "bearer", tokenEnv: name }))
    expect(set.auth).toMatchObject({ type: "bearer", token: "tok" })
  })

  it("sends a token stored in the profile", () => {
    expect(resolveAuth({}, {}, profile({ type: "bearer", token: "Bearer lit.eral" }))).toEqual({
      auth: {
        type: "bearer",
        token: "lit.eral",
        source: "profile",
        origin: 'auth.token of profile "prod"',
        profile: "prod",
      },
      source: "profile",
    })
  })

  it("fails when bearer auth is selected without a token, saying where it looked", () => {
    const error = failure(() => resolveAuth({ auth: "bearer" }, {}, NO_PROFILE))
    expect(error.code).toBe("CONFIG")
    expect(error.exitCode).toBe(3)
    expect(error.message).toBe("Bearer auth is selected but the token is missing")
    expect(error.details.hint).toBe(
      "Bearer auth was selected by --auth bearer. Looked up the token in --auth-token-stdin, OPERATE_TOKEN, OPERATE_TOKEN_COMMAND and a profile (none is selected). Fetch a token with the tool that issues it (e.g. az account get-access-token, gcloud auth print-access-token) and export OPERATE_TOKEN=<token>, let operate run that tool with export OPERATE_TOKEN_COMMAND=<command>, pipe it into --auth-token-stdin, or store the name of its variable with `operate config set <profile> --auth bearer --auth-token-env <VAR>`; --auth none switches bearer auth off.",
    )
    const stored = failure(() => resolveAuth({}, {}, profile({ type: "bearer" })))
    expect(stored.details.hint).toContain(
      'Bearer auth was selected by the auth.type of profile "prod". Looked up the token in --auth-token-stdin, OPERATE_TOKEN, OPERATE_TOKEN_COMMAND and the auth.tokenEnv and auth.token of profile "prod".',
    )
    expect(stored.details.hint).toContain(
      "`operate config set prod --auth bearer --auth-token-env <VAR>`",
    )
  })

  it("refuses an invalid token naming its source, never the token", () => {
    const error = failure(() =>
      resolveAuth({}, { OPERATE_TOKEN: '{"access_token":"s3cr3t"}' }, NO_PROFILE),
    )
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe(
      "The bearer token from OPERATE_TOKEN has characters a bearer token cannot have (RFC 6750)",
    )
    expect(JSON.stringify(error.details)).not.toContain("s3cr3t")
  })

  it("refuses --auth-password-stdin with bearer auth: stdin would be read for nothing", () => {
    const error = failure(() =>
      resolveAuth({ auth: "bearer", authPassword: "pw" }, { OPERATE_TOKEN: "t" }, NO_PROFILE),
    )
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe(
      "--auth-password-stdin reads a Basic auth password, but bearer auth is selected by --auth bearer",
    )
    expect(error.details.hint).toBe(
      "Drop --auth-password-stdin: bearer auth sends a token (--auth-token-stdin or OPERATE_TOKEN), no password.",
    )
  })

  it("takes the token from the highest source (property)", () => {
    const optional = fc.option(b64tokens, { nil: undefined })
    fc.assert(
      fc.property(
        optional,
        optional,
        fc.option(fc.record({ variableSet: fc.boolean(), value: b64tokens }), { nil: undefined }),
        optional,
        (flag, env, tokenEnv, stored) => {
          const auth: ProfileAuth = compact({
            type: "bearer" as const,
            tokenEnv: tokenEnv === undefined ? undefined : "CI_TOKEN",
            token: stored,
          })
          const variables = compact({
            OPERATE_TOKEN: env,
            CI_TOKEN: tokenEnv?.variableSet === true ? tokenEnv.value : undefined,
          })
          const resolve = () => resolveAuth(compact({ authToken: flag }), variables, profile(auth))
          const expected =
            flag ??
            env ??
            (tokenEnv === undefined ? stored : tokenEnv.variableSet ? tokenEnv.value : "unset")
          if (expected === undefined || expected === "unset") {
            expect(failure(resolve).code).toBe("CONFIG")
            return
          }
          const resolved = resolve().auth
          expect(resolved).toMatchObject({ type: "bearer", token: expected })
        },
      ),
    )
  })
})

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

describe("selectedAuth with bearer tokens", () => {
  it("is bearer for a token without reading the token variable, undefined for a conflict", () => {
    expect(selectedAuth({}, { OPERATE_TOKEN: "t" }, NO_PROFILE)).toEqual({
      type: "bearer",
      source: "env",
      label: "a bearer token (from OPERATE_TOKEN) without an auth type",
      token: { origin: "OPERATE_TOKEN", command: false },
    })
    expect(selectedAuth({}, {}, profile({ type: "bearer", tokenEnv: "UNSET" }))).toEqual({
      type: "bearer",
      source: "profile",
      label: 'the auth.type of profile "prod"',
      token: { origin: 'auth.tokenEnv of profile "prod"', command: false },
    })
    expect(selectedAuth({}, { OPERATE_AUTH: "bearer" }, NO_PROFILE)).toEqual({
      type: "bearer",
      source: "env",
      label: "OPERATE_AUTH=bearer",
    })
    expect(selectedAuth({}, {}, NO_PROFILE)).toEqual({
      type: "none",
      source: "default",
      label: "no auth settings",
    })
    expect(selectedAuth({ authUser: "u" }, { OPERATE_TOKEN: "t" }, NO_PROFILE)).toBeUndefined()
  })
})

describe("bearer auth and an Authorization header", () => {
  const bearer = resolveAuth({}, { OPERATE_TOKEN: "t" }, NO_PROFILE).auth

  it("is a CONFIG error naming where the header comes from", () => {
    const error = authorizationConflict(bearer, "env", undefined)
    expect(error?.code).toBe("CONFIG")
    expect(error?.message).toBe("Bearer auth and an Authorization header are both configured")
    expect(error?.details.hint).toBe(
      "Drop one: remove the Authorization header (from OPERATE_HEADERS), or switch Bearer auth off with --auth none, OPERATE_AUTH=none or `operate config unset <profile> auth`.",
    )
    expect(authorizationConflict(bearer, "flag", "p", true)?.details.hint).toBe(
      "Remove the Authorization header (given with -H/--header): with bearer auth, operate sends the token in it.",
    )
  })

  it("is raised by resolveConfig for -H, OPERATE_HEADERS and profile headers", () => {
    const header = ["Authorization: Bearer other"]
    expect(
      failure(() => resolveConfig({ headers: header }, { OPERATE_TOKEN: "t" }, undefined)).message,
    ).toBe("Bearer auth and an Authorization header are both configured")
    const file = {
      profiles: {
        p: { auth: { type: "bearer" as const, token: "t" }, headers: { authorization: "x" } },
      },
    }
    expect(failure(() => resolveConfig({ profile: "p" }, {}, file)).details.hint).toContain(
      'from the headers of profile "p"',
    )
    expect(resolveHeaders({ headers: header }, {}, undefined).authorization).toBe("flag")
  })

  it("passes the unused token through resolveConfig", () => {
    const resolved = resolveConfig({ auth: "none" }, { OPERATE_TOKEN: "tok" }, undefined)
    expect(resolved.unusedToken).toEqual({
      value: "tok",
      source: "env",
      reason: "bearer auth is switched off by --auth none",
    })
    expect(resolveConfig({}, {}, undefined).unusedToken).toBeUndefined()
  })
})
