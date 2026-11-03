import { afterEach, describe, expect, it, vi } from "vitest"
import { OAUTH_ENV_VARS, oauthFromEnv } from "./oauth-env.js"

const KEYCLOAK = {
  MCP_USE_OAUTH_KEYCLOAK_SERVER_URL: "https://kc.example.com",
  MCP_USE_OAUTH_KEYCLOAK_REALM: "platform",
}
const AUTH0 = { MCP_USE_OAUTH_AUTH0_DOMAIN: "tenant.auth0.com" }

const fromEnv = (env: NodeJS.ProcessEnv) => oauthFromEnv(env, "test-root")

/** The token mcp-use hands `mapAuthInfo` once it verified the JWT. */
const verified = (payload: Record<string, unknown>) => ({
  token: "t",
  clientId: "c",
  scopes: [],
  extra: { payload },
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("oauthFromEnv: the providers", () => {
  it("reads exactly the variables of the provider table", () => {
    expect(OAUTH_ENV_VARS).toEqual([
      "MCP_USE_OAUTH_KEYCLOAK_SERVER_URL",
      "MCP_USE_OAUTH_KEYCLOAK_REALM",
      "MCP_USE_OAUTH_AUTH0_DOMAIN",
      "MCP_USE_OAUTH_WORKOS_SUBDOMAIN",
      "MCP_USE_OAUTH_BETTER_AUTH_URL",
      "MCP_USE_OAUTH_CONVEX_AUTH_URL",
    ])
  })

  it("installs nothing without a provider's variables, and says what that means once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(fromEnv({})).toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toBe(
      "[test-root] No OAuth provider is configured (MCP_USE_OAUTH_*), so there is no caller identity: modules without an explicit toolset run read-only. Set one provider's MCP_USE_OAUTH_* variables, or widen with MCP_ACTIVE_MODULES=<module>:<toolset> (anyone who reaches this port gets that surface).",
    )
  })

  it("counts a blank value as unset, and mcp-use's other variables as no provider", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(fromEnv({ MCP_USE_OAUTH_AUTH0_DOMAIN: "  " })).toBeUndefined()
    expect(fromEnv({ MCP_USE_OAUTH_DEBUG: "true" })).toBeUndefined()
    expect(fromEnv({ MCP_OAUTH: undefined })).toBeUndefined()
    expect(
      fromEnv({ MCP_USE_LOG_LEVEL: "info", MCP_USE_DEV_CLI: "1", MCP_USE_API_KEY: "k" }),
    ).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(4)
  })

  // Exact values: swapped server URL and realm would still construct.
  it("builds a Keycloak provider with the exact realm endpoints", () => {
    const provider = fromEnv(KEYCLOAK)
    expect(provider?.oauthMetadata.issuer).toBe("https://kc.example.com/realms/platform")
    expect(provider?.oauthMetadata.authorization_endpoint).toBe(
      "https://kc.example.com/realms/platform/protocol/openid-connect/auth",
    )
    expect(provider?.oauthMetadata.token_endpoint).toBe(
      "https://kc.example.com/realms/platform/protocol/openid-connect/token",
    )
  })

  it("builds an Auth0 provider from the bare tenant domain and from its issuer URL alike", () => {
    for (const domain of [
      "tenant.auth0.com",
      "https://tenant.auth0.com",
      "https://tenant.auth0.com/",
    ]) {
      const provider = fromEnv({ MCP_USE_OAUTH_AUTH0_DOMAIN: domain })
      expect(provider?.oauthMetadata.issuer, domain).toBe("https://tenant.auth0.com/")
      expect(provider?.oauthMetadata.token_endpoint, domain).toBe(
        "https://tenant.auth0.com/oauth/token",
      )
    }
  })

  it.each([
    [KEYCLOAK, "https://kc.example.com/realms/platform"],
    [AUTH0, "https://tenant.auth0.com/"],
    [{ MCP_USE_OAUTH_WORKOS_SUBDOMAIN: "acme.authkit.app" }, "https://acme.authkit.app"],
    [
      { MCP_USE_OAUTH_BETTER_AUTH_URL: "https://auth.example.com/api/auth" },
      "https://auth.example.com/api/auth",
    ],
    [
      { MCP_USE_OAUTH_CONVEX_AUTH_URL: "https://example.convex.site" },
      "https://example.convex.site",
    ],
  ])(
    "builds the provider %j names and maps the token subject to user.id (what callerUserId reads)",
    (env, issuer) => {
      const provider = fromEnv(env)!
      expect(provider.oauthMetadata.issuer).toBe(issuer)
      const extra = provider.mapAuthInfo(verified({ sub: "user-123", realm_access: { roles: [] } }))
      expect(extra.user).toMatchObject({ id: "user-123" })
      expect(extra.user).not.toHaveProperty("userId")
    },
  )
})

describe("oauthFromEnv: a deployment that asked for OAuth never boots without it", () => {
  it("refuses the retired JSON variable, blank included, and says what replaces it", () => {
    for (const value of ['{"provider":"keycloak"}', ""]) {
      expect(() => fromEnv({ MCP_OAUTH: value })).toThrow(
        'MCP_OAUTH is no longer read, so the server does not start without the OAuth it asks for. Unset it and set one provider\'s MCP_USE_OAUTH_* variables instead: {"provider":"keycloak",…} becomes MCP_USE_OAUTH_KEYCLOAK_SERVER_URL and MCP_USE_OAUTH_KEYCLOAK_REALM, {"provider":"auth0",…} becomes MCP_USE_OAUTH_AUTH0_DOMAIN.',
      )
    }
  })

  it("refuses a look-alike of the retired variable, the likeliest migration typo", () => {
    expect(() => fromEnv({ MCP_OAUTH_KEYCLOAK_SERVER_URL: "https://kc.example.com" })).toThrow(
      /^MCP_OAUTH_KEYCLOAK_SERVER_URL is no longer read/,
    )
    expect(() => fromEnv({ ...KEYCLOAK, MCP_OAUTH: "{}", MCP_OAUTH_X: "1" })).toThrow(
      /^MCP_OAUTH, MCP_OAUTH_X are no longer read, .* Unset them and set/,
    )
  })

  it.each([
    "MCP_USE_OAUTH_KEYCLOAK_AUDIENCE",
    "MCP_USE_OAUTH_CLERK_FRONTEND_API_URL",
    "MCP_USE_OAUTH_KEYCLOAK_REALMS",
  ])("refuses %s, a variable it does not read", (name) => {
    expect(() => fromEnv({ ...KEYCLOAK, [name]: "https://x.example/mcp" })).toThrow(
      `${name} is not read by this server, so it does not start. Unset it: the server reads one provider's variables, Keycloak (MCP_USE_OAUTH_KEYCLOAK_SERVER_URL, MCP_USE_OAUTH_KEYCLOAK_REALM), Auth0 (MCP_USE_OAUTH_AUTH0_DOMAIN), WorkOS (MCP_USE_OAUTH_WORKOS_SUBDOMAIN), Better Auth (MCP_USE_OAUTH_BETTER_AUTH_URL) or Convex (MCP_USE_OAUTH_CONVEX_AUTH_URL), and takes the token audience from MCP_URL (RFC 8707).`,
    )
  })

  // The typo warner leaves mcp-use's namespace alone, so only this sees a misspelled prefix.
  it.each(["MCP_USE_OAUH_KEYCLOAK_SERVER_URL", "MCP_USE_AUTH0_DOMAIN", "MCP_USE_OAUTHDEBUG"])(
    "refuses %s, a misspelled OAuth variable, instead of booting without OAuth",
    (name) => {
      expect(() => fromEnv({ [name]: "https://kc.example.com" })).toThrow(
        new RegExp(`^${name} is not read by this server, so it does not start\\.`),
      )
    },
  )

  // mcp-use would take a blank audience as `resource: ""` and fail with another message.
  it("refuses a blank unread variable too, and names every unread one", () => {
    expect(() => fromEnv({ ...KEYCLOAK, MCP_USE_OAUTH_KEYCLOAK_AUDIENCE: "" })).toThrow(
      /^MCP_USE_OAUTH_KEYCLOAK_AUDIENCE is not read by this server/,
    )
    expect(() =>
      fromEnv({ MCP_USE_OAUTH_SECRET: "s", MCP_USE_OAUTH_AUTH0_AUDIENCE: "https://x/mcp" }),
    ).toThrow(
      /^MCP_USE_OAUTH_AUTH0_AUDIENCE, MCP_USE_OAUTH_SECRET are not read by this server, so it does not start\. Unset them:/,
    )
  })

  // mcp-use's Auth0 factory reads its audience from process.env whatever the code passes.
  it("refuses an unread variable that only process.env holds", () => {
    vi.stubEnv("MCP_USE_OAUTH_AUTH0_AUDIENCE", "https://elsewhere.example/mcp")
    expect(() => fromEnv(AUTH0)).toThrow(/^MCP_USE_OAUTH_AUTH0_AUDIENCE is not read/)
  })

  it("refuses the variables of two providers, naming both", () => {
    expect(() => fromEnv({ ...KEYCLOAK, ...AUTH0 })).toThrow(
      "OAuth variables of more than one provider are set: Keycloak (MCP_USE_OAUTH_KEYCLOAK_SERVER_URL, MCP_USE_OAUTH_KEYCLOAK_REALM), Auth0 (MCP_USE_OAUTH_AUTH0_DOMAIN). Keep the variables of one provider and unset the others.",
    )
  })

  it("refuses an incomplete provider, naming the variable that is unset", () => {
    expect(() => fromEnv({ MCP_USE_OAUTH_KEYCLOAK_REALM: "platform" })).toThrow(
      "Keycloak OAuth needs MCP_USE_OAUTH_KEYCLOAK_SERVER_URL and MCP_USE_OAUTH_KEYCLOAK_REALM, but MCP_USE_OAUTH_KEYCLOAK_SERVER_URL is unset.",
    )
    expect(() => fromEnv({ ...KEYCLOAK, MCP_USE_OAUTH_KEYCLOAK_REALM: " " })).toThrow(
      /but MCP_USE_OAUTH_KEYCLOAK_REALM is unset\.$/,
    )
  })

  it("refuses a value mcp-use cannot honor, with mcp-use's error as the cause", () => {
    let thrown: unknown
    try {
      fromEnv({ ...KEYCLOAK, MCP_USE_OAUTH_KEYCLOAK_SERVER_URL: "http://kc.internal:8080" })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    const error = thrown as Error
    expect(error.message).toBe(
      "Keycloak OAuth (MCP_USE_OAUTH_KEYCLOAK_SERVER_URL, MCP_USE_OAUTH_KEYCLOAK_REALM) is invalid: Keycloak serverUrl must use HTTPS, or HTTP for localhost, without credentials, query, or fragment",
    )
    expect(error.cause).toBeInstanceOf(Error)
    expect((error.cause as Error).message).toBe(
      "Keycloak serverUrl must use HTTPS, or HTTP for localhost, without credentials, query, or fragment",
    )
  })
})
