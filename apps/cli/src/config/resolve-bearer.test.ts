import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { b64tokens } from "../../test/support/bearer.js"
import { NO_PROFILE, profile } from "../../test/support/config-auth.js"
import { failure } from "../../test/support/failure.js"
import { compact } from "../util.js"
import { resolveHeaders } from "./headers.js"
import { authorizationConflict, resolveAuth, selectedAuth } from "./resolve-auth.js"
import { resolveConfig } from "./resolve.js"
import type { ProfileAuth } from "./types.js"

describe("resolveAuth with a bearer token", () => {
  it("sends the token of PULSE_CLI_TOKEN with --auth bearer", () => {
    expect(resolveAuth({ auth: "bearer" }, { PULSE_CLI_TOKEN: "abc.def" }, NO_PROFILE)).toEqual({
      auth: {
        type: "bearer",
        token: "abc.def",
        source: "env",
        origin: "PULSE_CLI_TOKEN",
        variable: "PULSE_CLI_TOKEN",
      },
      source: "flag",
    })
  })

  it('normalizes the token: a pasted "Bearer " and blanks go', () => {
    const resolved = resolveAuth({}, { PULSE_CLI_TOKEN: "  Bearer abc.def== \n" }, NO_PROFILE)
    expect(resolved.auth).toMatchObject({ type: "bearer", token: "abc.def==" })
  })

  it("reads the token of --auth-token-stdin first", () => {
    const resolved = resolveAuth(
      { authToken: "from-stdin" },
      { PULSE_CLI_TOKEN: "from-env", PULSE_CLI_AUTH: "bearer" },
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
    // the unset variable does not matter when PULSE_CLI_TOKEN has a token
    expect(resolveAuth({}, { PULSE_CLI_TOKEN: "env.token" }, stored).auth).toMatchObject({
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
        "Export it, e.g. export CI_TOKEN=<token>, or name another variable with `pulse-cli config set prod --auth-token-env <VAR>`.",
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
      "Its name is not in the usual upper-case form, so it is not repeated: it may be a token stored by mistake. Check auth.tokenEnv in the config file (`pulse-cli config path`), or name another variable with `pulse-cli config set prod --auth-token-env <VAR>`.",
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
      "Bearer auth was selected by --auth bearer. Looked up the token in --auth-token-stdin, PULSE_CLI_TOKEN, PULSE_CLI_TOKEN_COMMAND and a profile (none is selected). Fetch a token with the tool that issues it (e.g. az account get-access-token, gcloud auth print-access-token) and export PULSE_CLI_TOKEN=<token>, let pulse-cli run that tool with export PULSE_CLI_TOKEN_COMMAND=<command>, pipe it into --auth-token-stdin, or store the name of its variable with `pulse-cli config set <profile> --auth bearer --auth-token-env <VAR>`; --auth none switches bearer auth off.",
    )
    const stored = failure(() => resolveAuth({}, {}, profile({ type: "bearer" })))
    expect(stored.details.hint).toContain(
      'Bearer auth was selected by the auth.type of profile "prod". Looked up the token in --auth-token-stdin, PULSE_CLI_TOKEN, PULSE_CLI_TOKEN_COMMAND and the auth.tokenEnv and auth.token of profile "prod".',
    )
    expect(stored.details.hint).toContain(
      "`pulse-cli config set prod --auth bearer --auth-token-env <VAR>`",
    )
  })

  it("refuses an invalid token naming its source, never the token", () => {
    const error = failure(() =>
      resolveAuth({}, { PULSE_CLI_TOKEN: '{"access_token":"s3cr3t"}' }, NO_PROFILE),
    )
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe(
      "The bearer token from PULSE_CLI_TOKEN has characters a bearer token cannot have (RFC 6750)",
    )
    expect(JSON.stringify(error.details)).not.toContain("s3cr3t")
  })

  it("refuses --auth-password-stdin with bearer auth: stdin would be read for nothing", () => {
    const error = failure(() =>
      resolveAuth({ auth: "bearer", authPassword: "pw" }, { PULSE_CLI_TOKEN: "t" }, NO_PROFILE),
    )
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe(
      "--auth-password-stdin reads a Basic auth password, but bearer auth is selected by --auth bearer",
    )
    expect(error.details.hint).toBe(
      "Drop --auth-password-stdin: bearer auth sends a token (--auth-token-stdin or PULSE_CLI_TOKEN), no password.",
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
            PULSE_CLI_TOKEN: env,
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

describe("selectedAuth with bearer tokens", () => {
  it("is bearer for a token without reading the token variable, undefined for a conflict", () => {
    expect(selectedAuth({}, { PULSE_CLI_TOKEN: "t" }, NO_PROFILE)).toEqual({
      type: "bearer",
      source: "env",
      label: "a bearer token (from PULSE_CLI_TOKEN) without an auth type",
      token: { origin: "PULSE_CLI_TOKEN", command: false },
    })
    expect(selectedAuth({}, {}, profile({ type: "bearer", tokenEnv: "UNSET" }))).toEqual({
      type: "bearer",
      source: "profile",
      label: 'the auth.type of profile "prod"',
      token: { origin: 'auth.tokenEnv of profile "prod"', command: false },
    })
    expect(selectedAuth({}, { PULSE_CLI_AUTH: "bearer" }, NO_PROFILE)).toEqual({
      type: "bearer",
      source: "env",
      label: "PULSE_CLI_AUTH=bearer",
    })
    expect(selectedAuth({}, {}, NO_PROFILE)).toEqual({
      type: "none",
      source: "default",
      label: "no auth settings",
    })
    expect(selectedAuth({ authUser: "u" }, { PULSE_CLI_TOKEN: "t" }, NO_PROFILE)).toBeUndefined()
  })
})

describe("bearer auth and an Authorization header", () => {
  const bearer = resolveAuth({}, { PULSE_CLI_TOKEN: "t" }, NO_PROFILE).auth

  it("is a CONFIG error naming where the header comes from", () => {
    const error = authorizationConflict(bearer, "env", undefined)
    expect(error?.code).toBe("CONFIG")
    expect(error?.message).toBe("Bearer auth and an Authorization header are both configured")
    expect(error?.details.hint).toBe(
      "Drop one: remove the Authorization header (from PULSE_CLI_HEADERS), or switch Bearer auth off with --auth none, PULSE_CLI_AUTH=none or `pulse-cli config unset <profile> auth`.",
    )
    expect(authorizationConflict(bearer, "flag", "p", true)?.details.hint).toBe(
      "Remove the Authorization header (given with -H/--header): with bearer auth, pulse-cli sends the token in it.",
    )
  })

  it("is raised by resolveConfig for -H, PULSE_CLI_HEADERS and profile headers", () => {
    const header = ["Authorization: Bearer other"]
    expect(
      failure(() => resolveConfig({ headers: header }, { PULSE_CLI_TOKEN: "t" }, undefined))
        .message,
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
    const resolved = resolveConfig({ auth: "none" }, { PULSE_CLI_TOKEN: "tok" }, undefined)
    expect(resolved.unusedToken).toEqual({
      value: "tok",
      source: "env",
      reason: "bearer auth is switched off by --auth none",
    })
    expect(resolveConfig({}, {}, undefined).unusedToken).toBeUndefined()
  })
})
