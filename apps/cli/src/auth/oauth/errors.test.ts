import { describe, expect, it } from "vitest"
import { cachedLogin, oauthConfig } from "../../../test/support/oauth.js"
import { OperateError } from "../../errors.js"
import {
  cannotRefresh,
  checkUsable,
  iso,
  loginCommand,
  loginFailed,
  loginHint,
  loginRequired,
  notLoggedIn,
  otherIdentity,
  owner,
  profileNote,
  removedWhileRunning,
  statusCommand,
  unknownFormat,
} from "./errors.js"

const NOW = 1_700_000_000_000
const P = { profile: "p" }
const HINT =
  "Run `operate auth login --profile p` in a terminal: a person logs in once in the browser, operate refreshes the token afterwards. Agents cannot log in themselves."

function thrown(action: () => void): OperateError {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(OperateError)
    return error as OperateError
  }
  throw new Error("expected an error")
}

describe("login hint", () => {
  it("names the profile, or OPERATE_AUTH and the OPERATE_OAUTH_* settings without one", () => {
    expect(loginHint(P)).toBe(HINT)
    expect(loginHint({})).toBe(
      "Run `operate auth login` in a terminal with OPERATE_AUTH=oauth and the same OPERATE_OAUTH_* settings: a person logs in once in the browser, operate refreshes the token afterwards. Agents cannot log in themselves.",
    )
    expect(loginCommand({ profile: "prod" })).toBe("operate auth login --profile prod")
    expect(loginCommand({ configFile: "/c.json" })).toBe("operate auth login")
    expect(owner("p")).toBe('profile "p"')
    expect(owner(undefined)).toBe("the environment configuration")
    expect(profileNote("p")).toBe('(profile "p")')
    expect(profileNote(undefined)).toBe("(no profile)")
  })

  it("builds LOGIN_REQUIRED and LOGIN_FAILED with exit code 4", () => {
    const required = loginRequired("m", P, "Why.")
    expect(required).toMatchObject({ code: "LOGIN_REQUIRED", message: "m" })
    expect(required.exitCode).toBe(4)
    expect(required.details.hint).toBe(`Why. ${HINT}`)
    expect(loginRequired("m", P).details.hint).toBe(HINT)
    const failed = loginFailed("f", "h")
    expect(failed).toMatchObject({ code: "LOGIN_FAILED", message: "f", details: { hint: "h" } })
    expect(failed.exitCode).toBe(4)
  })

  it("has the messages of design §16.9", () => {
    expect(notLoggedIn(P).message).toBe('Not logged in: profile "p" has no OAuth login')
    expect(unknownFormat("/t.json", P).message).toBe(
      "The token cache /t.json has an unknown format",
    )
    expect(removedWhileRunning(P).message).toBe(
      'The OAuth login of profile "p" was removed while this command ran',
    )
    expect(removedWhileRunning(P).details.hint).toBe(
      `A logout (also of a profile that shares the login) or \`operate config set|unset|delete\` removed it. ${HINT}`,
    )
    expect(iso(0)).toBe("1970-01-01T00:00:00.000Z")
  })

  it("says that one login serves the profiles with the same settings, but not without a profile", () => {
    expect(notLoggedIn(P).details.hint).toBe(
      `One login serves every OAuth profile of the same config file, project file or repository that stores the same issuer, client, audience and scopes. ${HINT}`,
    )
    expect(notLoggedIn({}).details.hint).toBe(loginHint({}))
  })

  it("names where to log in: the project directory, a config file named by --config", () => {
    expect(loginHint({ profile: "p", projectDirectory: "/work/shop" })).toContain(
      "Run `operate auth login --profile p` in a terminal in /work/shop: a person",
    )
    expect(loginCommand({ profile: "p", configFile: "/home/me/ci/operate.json" })).toBe(
      "operate auth login --config /home/me/ci/operate.json --profile p",
    )
    expect(loginCommand({ profile: "p", configFile: "/home/me/my files/it's.json" })).toBe(
      "operate auth login --config '/home/me/my files/it'\\''s.json' --profile p",
    )
    expect(loginCommand({ profile: "p", configFile: "C:\\Users\\me\\op.json" })).toBe(
      "operate auth login --config C:\\Users\\me\\op.json --profile p",
    )
    expect(statusCommand({ profile: "p", configFile: "/c.json" })).toBe(
      "operate auth status --config /c.json --profile p",
    )
    expect(statusCommand({})).toBe("operate auth status")
    const who = { profile: "p", projectDirectory: "/work/shop" }
    const login = cachedLogin(NOW, { refreshRejected: { at: NOW, error: "invalid_grant" } })
    expect(cannotRefresh(login, NOW, who).details.hint).toContain("in a terminal in /work/shop:")
    expect(removedWhileRunning(who).details.hint).toContain("in /work/shop:")
  })
})

describe("otherIdentity", () => {
  const stored = cachedLogin(NOW).identity
  const PREFIX =
    'The OAuth login of profile "p" was made for another issuer, client, audience or scopes: '

  it("names each field that differs, and that the settings changed since the login", () => {
    const error = otherIdentity(
      stored,
      oauthConfig({ clientId: "other", audience: "engine-rest", scopes: ["openid"] }),
    )
    expect(error.code).toBe("LOGIN_REQUIRED")
    expect(error.message).toBe(
      `${PREFIX}client "operate-cli" (the configuration asks for "other"); audience none (the configuration asks for "engine-rest"); scopes "offline_access openid" (the configuration asks for "openid")`,
    )
    expect(error.details.hint).toBe(
      `The login was made with other settings: OPERATE_OAUTH_* variables were set where the login ran (also through another profile that shares the login). ${HINT}`,
    )
  })

  it("names the OPERATE_OAUTH_* variables of this environment that make the difference", () => {
    const config = oauthConfig({
      issuer: "https://other.example.com",
      scopes: ["openid", "profile"],
      sources: {
        endpoints: "env",
        clientId: "profile",
        scopes: "env",
        redirectPort: "default",
      },
    })
    const error = otherIdentity(stored, config)
    expect(error.message).toBe(
      `${PREFIX}issuer "https://login.example.com/realms/camunda" (the configuration asks for "https://other.example.com"); scopes "offline_access openid" (the configuration asks for "openid profile")`,
    )
    expect(error.details.hint).toBe(
      `OPERATE_OAUTH_ISSUER, OPERATE_OAUTH_SCOPES of this environment make the difference: run the login below with the same values, or unset them here. ${HINT}`,
    )
    const single = otherIdentity(
      stored,
      oauthConfig({ clientId: "x", sources: { ...config.sources, clientId: "env" } }),
    )
    expect(single.details.hint).toBe(
      `OPERATE_OAUTH_CLIENT_ID of this environment makes the difference: run the login below with the same value, or unset it here. ${HINT}`,
    )
  })

  it("names an explicit token endpoint and an audience from the environment", () => {
    const config = oauthConfig({
      authorizationEndpoint: "https://a.example.com/auth",
      tokenEndpoint: "https://a.example.com/token",
      audience: "api",
      sources: {
        endpoints: "env",
        clientId: "profile",
        scopes: "default",
        redirectPort: "default",
        audience: "env",
      },
    })
    const error = otherIdentity(stored, config)
    expect(error.message).toBe(
      `${PREFIX}token endpoint none (the configuration asks for "https://a.example.com/token"); audience none (the configuration asks for "api")`,
    )
    expect(error.details.hint).toContain(
      "OPERATE_OAUTH_TOKEN_ENDPOINT, OPERATE_OAUTH_AUDIENCE of this",
    )
  })
})

describe("checkUsable", () => {
  it("accepts a valid access token or a usable refresh token", () => {
    expect(() => {
      checkUsable(cachedLogin(NOW), NOW, P)
    }).not.toThrow()
    expect(() => {
      checkUsable(cachedLogin(NOW, { expiresAt: NOW - 1 }), NOW, P)
    }).not.toThrow()
    expect(() => {
      checkUsable(cachedLogin(NOW, { refreshToken: null, expiresAt: null }), NOW, P)
    }).not.toThrow()
  })

  it("rejects an expired token without a refresh token", () => {
    const error = thrown(() => {
      checkUsable(cachedLogin(NOW, { refreshToken: null, expiresAt: NOW }), NOW, P)
    })
    expect(error.code).toBe("LOGIN_REQUIRED")
    expect(error.message).toBe(
      'The access token of profile "p" expired at 2023-11-14T22:13:20.000Z and there is no refresh token',
    )
    expect(error.details.hint).toBe(
      `Request the offline_access scope or allow refresh tokens for the client, so that operate can refresh the token. ${HINT}`,
    )
  })

  it("rejects an expired login", () => {
    const login = cachedLogin(NOW, { expiresAt: NOW - 1, refreshExpiresAt: NOW - 1 })
    const error = thrown(() => {
      checkUsable(login, NOW, P)
    })
    expect(error.message).toBe('The OAuth login of profile "p" expired at 2023-11-14T22:13:19.999Z')
    expect(error.details.hint).toBe(HINT)
  })

  it("rejects a login whose refresh token the authorization server refused before", () => {
    const login = cachedLogin(NOW, {
      expiresAt: NOW - 1,
      refreshRejected: { at: NOW - 5000, error: "invalid_grant: Invalid refresh token" },
    })
    const error = thrown(() => {
      checkUsable(login, NOW, P)
    })
    expect(error.code).toBe("LOGIN_REQUIRED")
    expect(error.message).toBe(
      'The authorization server rejected the refresh token of profile "p" at 2023-11-14T22:13:15.000Z (invalid_grant: Invalid refresh token)',
    )
    expect(error.details.hint).toBe(
      `The session expired, was revoked, or the refresh token was replayed. ${HINT}`,
    )
    // a refusal is recorded only for a token due for a refresh or rejected: not usable either
    expect(() => {
      checkUsable({ ...login, expiresAt: NOW + 1 }, NOW, P)
    }).toThrow("rejected the refresh token")
  })

  it("uses the current time for unknown expiries in the message", () => {
    const login = cachedLogin(NOW, { refreshToken: null, expiresAt: null })
    expect(cannotRefresh(login, NOW, {}).message).toBe(
      "The access token of the environment configuration expired at 2023-11-14T22:13:20.000Z and there is no refresh token",
    )
    expect(cannotRefresh(cachedLogin(NOW, { refreshExpiresAt: null }), NOW, P).message).toBe(
      'The OAuth login of profile "p" expired at 2023-11-14T22:13:20.000Z',
    )
  })
})
