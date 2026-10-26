import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { PulseCliError } from "../errors.js"
import { resolveConfig } from "./resolve.js"
import { authorizationConflict, resolveAuth } from "./resolve-auth.js"
import { loginKeyOf } from "./login-key.js"
import { endpointSource } from "./resolve-oauth.js"
import type { ConfigFile, OAuthConfig, ProfileAuth, SelectedProfile } from "./types.js"

const ISSUER = "https://login.example.com/realms/camunda"

function failure(action: () => unknown): PulseCliError {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(PulseCliError)
    expect((error as PulseCliError).code).toBe("CONFIG")
    return error as PulseCliError
  }
  throw new Error("expected an error")
}

const ORIGIN = "config:/home/tester/.config/pulse-cli/config.json"

function profile(auth: ProfileAuth, name = "p"): SelectedProfile {
  return { name, profile: { auth }, origin: ORIGIN }
}

/** The login key of a profile of ORIGIN that stores ISSUER and client pulse-cli. */
const LOGIN = {
  origin: ORIGIN,
  issuer: ISSUER,
  tokenEndpoint: null,
  clientId: "pulse-cli",
  audience: null,
  scopes: ["offline_access", "openid"],
}

function oauth(
  flags: Parameters<typeof resolveAuth>[0],
  env: Record<string, string>,
  selected: SelectedProfile = {},
) {
  const resolved = resolveAuth(flags, env, selected)
  expect(resolved.auth.type).toBe("oauth")
  return resolved.auth as OAuthConfig
}

const STORED: ProfileAuth = { type: "oauth", issuer: ISSUER, clientId: "pulse-cli" }

describe("resolveAuth with OAuth", () => {
  it("resolves a profile with the defaults", () => {
    expect(resolveAuth({}, {}, profile(STORED))).toEqual({
      auth: {
        type: "oauth",
        issuer: ISSUER,
        clientId: "pulse-cli",
        scopes: ["openid", "offline_access"],
        redirectPort: 0,
        profile: "p",
        login: LOGIN,
        sources: {
          endpoints: "profile",
          clientId: "profile",
          scopes: "default",
          redirectPort: "default",
        },
      },
      source: "profile",
    })
  })

  it("keys the login on the origin and the stored settings, never on the environment", () => {
    const env = {
      PULSE_CLI_OAUTH_ISSUER: "https://other.example.com/realms/x",
      PULSE_CLI_OAUTH_SCOPES: "openid",
    }
    const stored = { ...STORED, audience: "engine-rest", scopes: ["openid", "openid", "email"] }
    expect(oauth({}, env, profile(stored)).login).toEqual({
      ...LOGIN,
      audience: "engine-rest",
      scopes: ["email", "openid"],
    })
    const endpoints = {
      type: "oauth" as const,
      authorizationEndpoint: `${ISSUER}/auth`,
      tokenEndpoint: `${ISSUER}/token`,
      clientId: "pulse-cli",
    }
    expect(oauth({}, {}, profile(endpoints)).login).toEqual({
      ...LOGIN,
      issuer: null,
      tokenEndpoint: `${ISSUER}/token`,
    })
    // a token endpoint without its authorization endpoint is no explicit endpoint
    const issuerOnly = { ...STORED, tokenEndpoint: `${ISSUER}/token` }
    expect(loginKeyOf(ORIGIN, issuerOnly)).toEqual(LOGIN)
  })

  it("has no login key without a profile, and names the directory of a project profile", () => {
    const env = { PULSE_CLI_OAUTH_ISSUER: ISSUER, PULSE_CLI_OAUTH_CLIENT_ID: "pulse-cli" }
    expect(oauth({ auth: "oauth" }, env).login).toBeUndefined()
    const project = { path: "/work/shop/.pulse-cli.json", directory: "/work/shop" }
    const selected: SelectedProfile = {
      name: "p",
      profile: { auth: STORED },
      project,
      origin: "repository:/work/shop/.git",
    }
    expect(oauth({}, {}, selected)).toMatchObject({
      login: { ...LOGIN, origin: "repository:/work/shop/.git" },
      projectDirectory: "/work/shop",
    })
  })

  it("resolves the environment alone", () => {
    const env = {
      PULSE_CLI_AUTH: "oauth",
      PULSE_CLI_OAUTH_ISSUER: ` ${ISSUER} `,
      PULSE_CLI_OAUTH_CLIENT_ID: "cli",
      PULSE_CLI_OAUTH_CLIENT_SECRET: " s e c ",
      PULSE_CLI_OAUTH_SCOPES: "openid, profile",
      PULSE_CLI_OAUTH_AUDIENCE: "engine-rest",
      PULSE_CLI_OAUTH_REDIRECT_PORT: "8765",
    }
    expect(resolveAuth({}, env, {})).toEqual({
      auth: {
        type: "oauth",
        issuer: ISSUER,
        clientId: "cli",
        clientSecret: " s e c ",
        scopes: ["openid", "profile"],
        audience: "engine-rest",
        redirectPort: 8765,
        sources: {
          endpoints: "env",
          clientId: "env",
          clientSecret: "env",
          scopes: "env",
          audience: "env",
          redirectPort: "env",
        },
      },
      source: "env",
    })
  })

  it("takes the type from --auth, PULSE_CLI_AUTH or the profile, never implies it", () => {
    expect(
      resolveAuth(
        { auth: "oauth" },
        { PULSE_CLI_OAUTH_ISSUER: ISSUER, PULSE_CLI_OAUTH_CLIENT_ID: "c" },
        {},
      ).source,
    ).toBe("flag")
    const env = { PULSE_CLI_OAUTH_ISSUER: ISSUER, PULSE_CLI_OAUTH_CLIENT_ID: "c" }
    expect(resolveAuth({}, env, {}).auth.type).toBe("none")
    expect(
      resolveAuth({}, { ...env, PULSE_CLI_USERNAME: "u", PULSE_CLI_PASSWORD: "p" }, {}).auth.type,
    ).toBe("basic")
  })

  it("resolves clientId, scopes, audience and redirectPort per value: env > profile > default", () => {
    const value = fc.option(fc.constantFrom("a", "b"), { nil: undefined })
    const port = fc.option(fc.constantFrom("2", "3"), { nil: undefined })
    const entry = (name: string, given: string | undefined) =>
      given === undefined ? {} : { [name]: given }
    fc.assert(
      fc.property(value, value, value, port, (envId, storedAudience, envAudience, envPort) => {
        const stored: ProfileAuth = {
          ...STORED,
          scopes: ["profile"],
          ...entry("audience", storedAudience),
          redirectPort: 1,
        }
        const env: Record<string, string> = {
          ...entry("PULSE_CLI_OAUTH_CLIENT_ID", envId),
          ...entry("PULSE_CLI_OAUTH_AUDIENCE", envAudience),
          ...entry("PULSE_CLI_OAUTH_REDIRECT_PORT", envPort),
        }
        const config = oauth({}, env, profile(stored))
        expect(config.clientId).toBe(envId ?? "pulse-cli")
        expect(config.sources.clientId).toBe(envId === undefined ? "profile" : "env")
        expect(config.audience).toBe(envAudience ?? storedAudience)
        expect(config.redirectPort).toBe(Number(envPort ?? 1))
        expect(config.scopes).toEqual(["profile"])
      }),
    )
    expect(
      oauth({}, { PULSE_CLI_OAUTH_SCOPES: "x y" }, profile({ ...STORED, scopes: [] })).scopes,
    ).toEqual(["x", "y"])
    expect(
      oauth({}, { PULSE_CLI_OAUTH_SCOPES: "  " }, profile({ ...STORED, scopes: [] })).scopes,
    ).toEqual([])
    expect(oauth({}, { PULSE_CLI_OAUTH_SCOPES: "," }, profile(STORED)).scopes).toEqual([])
  })

  it("resolves the issuer and endpoints as a unit from the most specific source", () => {
    const stored: ProfileAuth = {
      type: "oauth",
      clientId: "pulse-cli",
      authorizationEndpoint: "https://as/a",
      tokenEndpoint: "https://as/t",
    }
    const fromEnv = oauth({}, { PULSE_CLI_OAUTH_ISSUER: ISSUER }, profile(stored))
    expect(fromEnv).toMatchObject({ issuer: ISSUER, sources: { endpoints: "env" } })
    expect(fromEnv.authorizationEndpoint).toBeUndefined()
    expect(fromEnv.tokenEndpoint).toBeUndefined()
    const fromProfile = oauth({}, {}, profile(stored))
    expect(fromProfile).toMatchObject({
      authorizationEndpoint: "https://as/a",
      tokenEndpoint: "https://as/t",
    })
    expect(fromProfile.issuer).toBeUndefined()
    expect(endpointSource(fromProfile)).toBe('auth.tokenEndpoint of profile "p"')
    expect(endpointSource(fromEnv)).toBe("PULSE_CLI_OAUTH_ISSUER")
    expect(endpointSource(oauth({}, {}, profile(STORED)))).toBe('auth.issuer of profile "p"')
    const envEndpoints = oauth(
      {},
      {
        PULSE_CLI_OAUTH_AUTHORIZATION_ENDPOINT: "https://e/a",
        PULSE_CLI_OAUTH_TOKEN_ENDPOINT: "https://e/t",
      },
      profile(STORED),
    )
    expect(envEndpoints.issuer).toBeUndefined()
    expect(endpointSource(envEndpoints)).toBe("PULSE_CLI_OAUTH_TOKEN_ENDPOINT")
  })

  it("needs both endpoints or neither", () => {
    const error = failure(() =>
      resolveAuth({}, { PULSE_CLI_OAUTH_TOKEN_ENDPOINT: "https://e/t" }, profile(STORED)),
    )
    expect(error.message).toBe(
      "Only one OAuth endpoint is set (from PULSE_CLI_OAUTH_TOKEN_ENDPOINT)",
    )
    expect(error.details.hint).toBe(
      "Set both the authorization and the token endpoint, or neither and only the issuer (discovery).",
    )
    const stored = { ...STORED, authorizationEndpoint: "https://as/a" }
    expect(failure(() => resolveAuth({}, {}, profile(stored))).message).toBe(
      'Only one OAuth endpoint is set (auth.authorizationEndpoint of profile "p")',
    )
  })

  it("validates every value with its source", () => {
    expect(
      failure(() =>
        resolveAuth({}, { PULSE_CLI_OAUTH_ISSUER: "http://as.example.com" }, profile(STORED)),
      ).message,
    ).toBe(
      'The OAuth issuer (from PULSE_CLI_OAUTH_ISSUER) must use https:// (http:// only for localhost, 127.0.0.1 or [::1]), got "http://as.example.com"',
    )
    expect(
      failure(() => resolveAuth({}, { PULSE_CLI_OAUTH_REDIRECT_PORT: "99999" }, profile(STORED)))
        .message,
    ).toContain("(from PULSE_CLI_OAUTH_REDIRECT_PORT)")
    expect(
      failure(() => resolveAuth({}, { PULSE_CLI_OAUTH_SCOPES: "a a" }, profile(STORED))).message,
    ).toBe('The OAuth scope "a" is listed twice (from PULSE_CLI_OAUTH_SCOPES)')
    expect(
      failure(() => resolveAuth({}, { PULSE_CLI_OAUTH_CLIENT_ID: "ä" }, profile(STORED))).message,
    ).toContain("(from PULSE_CLI_OAUTH_CLIENT_ID)")
    expect(
      failure(() => resolveAuth({}, {}, profile({ ...STORED, audience: "ä" }))).message,
    ).toContain('(auth.audience of profile "p")')
  })

  it("resolves the client secret: env > the variable of clientSecretEnv > clientSecret", () => {
    const stored = { ...STORED, clientSecretEnv: "SECRET" }
    expect(
      oauth({}, { PULSE_CLI_OAUTH_CLIENT_SECRET: "e", SECRET: "v" }, profile(stored)),
    ).toMatchObject({ clientSecret: "e", sources: { clientSecret: "env" } })
    expect(oauth({}, { SECRET: "v" }, profile(stored))).toMatchObject({
      clientSecret: "v",
      sources: { clientSecret: "profile" },
    })
    expect(oauth({}, {}, profile({ ...STORED, clientSecret: "literal" }))).toMatchObject({
      clientSecret: "literal",
    })
    expect(
      oauth({}, { PULSE_CLI_OAUTH_CLIENT_SECRET: "  " }, profile(STORED)).clientSecret,
    ).toBeUndefined()
    const missing = failure(() => resolveAuth({}, { SECRET: " " }, profile(stored)))
    expect(missing.message).toBe(
      'The client secret variable SECRET (auth.clientSecretEnv of profile "p") is not set or empty',
    )
    expect(missing.details.hint).toBe(
      "Export it, e.g. export SECRET=<secret>, or name another variable with `pulse-cli config set p --oauth-client-secret-env <VAR>`.",
    )
    const control = failure(() => resolveAuth({}, { SECRET: "a\nb" }, profile(stored)))
    expect(control.message).toContain('(from SECRET, auth.clientSecretEnv of profile "p")')
    expect(control.message).not.toContain("a\nb")
  })

  it("names everything that is missing in one error", () => {
    const error = failure(() => resolveAuth({ auth: "oauth" }, {}, profile({})))
    expect(error.message).toBe("OAuth is selected but the issuer and the client id are missing")
    expect(error.details.hint).toBe(
      'OAuth was selected by --auth oauth. Looked up the issuer in PULSE_CLI_OAUTH_ISSUER, PULSE_CLI_OAUTH_AUTHORIZATION_ENDPOINT + PULSE_CLI_OAUTH_TOKEN_ENDPOINT and the auth.issuer / auth.authorizationEndpoint + auth.tokenEndpoint of profile "p"; the client id in PULSE_CLI_OAUTH_CLIENT_ID and the auth.clientId of profile "p". Store them with `pulse-cli config set <profile> --auth oauth --oauth-issuer <url> --oauth-client-id <id>`, or set the PULSE_CLI_OAUTH_* variables; --auth none switches OAuth off.',
    )
    expect(
      failure(() =>
        resolveAuth({}, { PULSE_CLI_AUTH: "oauth", PULSE_CLI_OAUTH_ISSUER: ISSUER }, {}),
      ).details.hint,
    ).toBe(
      "OAuth was selected by PULSE_CLI_AUTH=oauth. Looked up the client id in PULSE_CLI_OAUTH_CLIENT_ID and a profile (none is selected). Store them with `pulse-cli config set <profile> --auth oauth --oauth-issuer <url> --oauth-client-id <id>`, or set the PULSE_CLI_OAUTH_* variables; --auth none switches OAuth off.",
    )
    expect(
      failure(() => resolveAuth({}, {}, profile({ type: "oauth", clientId: "c" }))).message,
    ).toBe("OAuth is selected but the issuer is missing")
  })

  it("ignores the Basic auth inputs, but refuses --auth-password-stdin", () => {
    const config = oauth(
      { authUser: "u:x" },
      { PULSE_CLI_USERNAME: "u", PULSE_CLI_PASSWORD: "p" },
      profile(STORED),
    )
    expect(config.clientId).toBe("pulse-cli")
    const error = failure(() => resolveAuth({ authPassword: "pw" }, {}, profile(STORED)))
    expect(error.message).toBe(
      '--auth-password-stdin reads a Basic auth password, but OAuth is selected by the auth.type of profile "p"',
    )
    expect(error.details.hint).toBe(
      "Drop --auth-password-stdin: OAuth logs in with `pulse-cli auth login` and needs no password.",
    )
  })

  it("explains why OAuth settings are not used", () => {
    expect(resolveAuth({ auth: "none" }, {}, profile(STORED)).auth).toEqual({
      type: "none",
      off: "OAuth is switched off by --auth none",
    })
    expect(resolveAuth({}, {}, profile({ ...STORED, type: "none" })).auth).toEqual({
      type: "none",
      off: 'OAuth is switched off by the auth.type of profile "p"',
    })
    expect(
      resolveAuth({}, { PULSE_CLI_OAUTH_AUDIENCE: "x", PULSE_CLI_OAUTH_CLIENT_ID: "c" }, {}).auth,
    ).toEqual({
      type: "none",
      off: "OAuth settings are set (from PULSE_CLI_OAUTH_CLIENT_ID), but no auth type selects OAuth; set PULSE_CLI_AUTH=oauth or --auth oauth",
    })
    expect(resolveAuth({ auth: "none" }, { PULSE_CLI_OAUTH_CLIENT_ID: "c" }, {}).auth).toEqual({
      type: "none",
      off: "Basic auth is switched off by --auth none",
    })
    expect(
      resolveAuth({}, { PULSE_CLI_PASSWORD: "p", PULSE_CLI_OAUTH_CLIENT_ID: "c" }, {}).auth,
    ).toMatchObject({
      off: "a password is set (from PULSE_CLI_PASSWORD), but no username",
    })
  })
})

describe("OAuth and an Authorization header", () => {
  it("is a CONFIG error naming OAuth", () => {
    const config = oauth({}, {}, profile(STORED))
    const error = authorizationConflict(config, "flag", "p")
    expect(error?.message).toBe("OAuth and an Authorization header are both configured")
    expect(error?.details.hint).toBe(
      "Drop one: remove the Authorization header (given with -H/--header), or switch OAuth off with --auth none, PULSE_CLI_AUTH=none or `pulse-cli config unset p auth`.",
    )
  })

  it("is raised by resolveConfig before any request", () => {
    const file: ConfigFile = { defaultProfile: "p", profiles: { p: { auth: STORED } } }
    expect(failure(() => resolveConfig({ headers: ["Authorization: x"] }, {}, file)).message).toBe(
      "OAuth and an Authorization header are both configured",
    )
    expect(resolveConfig({}, {}, file).auth).toMatchObject({ type: "oauth", profile: "p" })
  })
})
