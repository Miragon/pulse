import { afterEach, describe, expect, it, vi } from "vitest"
import { OAUTH_DEBUG_ENV_VAR, OAUTH_ENV_VARS, oauthFromEnv, refuseOAuthEnv } from "./oauth-env.js"

const KEYCLOAK = {
  MCP_OAUTH_KEYCLOAK_SERVER_URL: "https://kc.example.com",
  MCP_OAUTH_KEYCLOAK_REALM: "platform",
}
const AUTH0 = { MCP_OAUTH_AUTH0_DOMAIN: "tenant.auth0.com" }

const fromEnv = (env: NodeJS.ProcessEnv) => oauthFromEnv(env, "test-root")

/** The token the verifier hands `mapAuthInfo` once it verified the JWT. */
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
  it("reads exactly the variables of the provider table, and its debug switch", () => {
    expect(OAUTH_ENV_VARS).toEqual([
      "MCP_OAUTH_KEYCLOAK_SERVER_URL",
      "MCP_OAUTH_KEYCLOAK_REALM",
      "MCP_OAUTH_AUTH0_DOMAIN",
      "MCP_OAUTH_WORKOS_SUBDOMAIN",
      "MCP_OAUTH_BETTER_AUTH_URL",
      "MCP_OAUTH_CONVEX_AUTH_URL",
    ])
    expect(OAUTH_DEBUG_ENV_VAR).toBe("MCP_OAUTH_DEBUG")
  })

  it("installs nothing without a provider's variables, and says what that means once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(fromEnv({})).toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toBe(
      "[test-root] No OAuth provider is configured (MCP_OAUTH_*), so there is no caller identity: a module with toolsets runs its read-only floor unless MCP_ACTIVE_MODULES names a toolset, and a module without toolsets registers every tool. Set one provider's MCP_OAUTH_* variables, or widen with MCP_ACTIVE_MODULES=<module>:<toolset> (anyone who reaches this port gets that surface).",
    )
  })

  it("counts a blank value as unset, and the debug switch or other MCP_ names as no provider", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(fromEnv({ MCP_OAUTH_AUTH0_DOMAIN: "  " })).toBeUndefined()
    expect(fromEnv({ MCP_OAUTH_DEBUG: "true" })).toBeUndefined()
    expect(fromEnv({ MCP_OAUTH: undefined })).toBeUndefined()
    expect(fromEnv({ MCP_LOG_LEVEL: "info", MCP_URL: "https://x", MCP_API_KEY: "k" })).toBe(
      undefined,
    )
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
      const provider = fromEnv({ MCP_OAUTH_AUTH0_DOMAIN: domain })
      expect(provider?.oauthMetadata.issuer, domain).toBe("https://tenant.auth0.com/")
      expect(provider?.oauthMetadata.token_endpoint, domain).toBe(
        "https://tenant.auth0.com/oauth/token",
      )
    }
  })

  it.each([
    [KEYCLOAK, "https://kc.example.com/realms/platform"],
    [AUTH0, "https://tenant.auth0.com/"],
    [{ MCP_OAUTH_WORKOS_SUBDOMAIN: "acme.authkit.app" }, "https://acme.authkit.app"],
    [
      { MCP_OAUTH_BETTER_AUTH_URL: "https://auth.example.com/api/auth" },
      "https://auth.example.com/api/auth",
    ],
    [{ MCP_OAUTH_CONVEX_AUTH_URL: "https://example.convex.site" }, "https://example.convex.site"],
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

describe("oauthFromEnv: what fails the boot", () => {
  it("refuses the retired JSON variable, blank included, and says what replaces it", () => {
    for (const value of ['{"provider":"keycloak"}', ""]) {
      expect(() => fromEnv({ MCP_OAUTH: value })).toThrow(
        'MCP_OAUTH is no longer read, so the server does not start without the OAuth it asks for. Unset it and set one provider\'s MCP_OAUTH_* variables instead: {"provider":"keycloak",…} becomes MCP_OAUTH_KEYCLOAK_SERVER_URL and MCP_OAUTH_KEYCLOAK_REALM, {"provider":"auth0",…} becomes MCP_OAUTH_AUTH0_DOMAIN.',
      )
    }
  })

  // The retired JSON variable's successors share its prefix: only the exact name is refused.
  it("reads the provider variables that share the retired variable's prefix", () => {
    expect(fromEnv(KEYCLOAK)?.oauthMetadata.issuer).toBe("https://kc.example.com/realms/platform")
    expect(() => fromEnv({ ...KEYCLOAK, MCP_OAUTH: "{}" })).toThrow(/^MCP_OAUTH is no longer read/)
  })

  // The typo warner speaks for these: none of them asks this reader for anything.
  it.each([
    "MCP_OAUTH_KEYCLOAK_AUDIENCE",
    "MCP_OAUTH_CLERK_FRONTEND_API_URL",
    "MCP_OAUTH_KEYCLOAK_REALMS",
    "MCP_FOO_OAUTH_KEYCLOAK_AUDIENCE",
    "MCP_OAUH_KEYCLOAK_SERVER_URL",
    "MCP_AUTH0_DOMAIN",
    "MCP_OAUTH_CALLBACK_URL",
    "MCP_INSPECTOR_OAUTH_STATE_PATH",
  ])(
    "takes %s for no provider: without one it boots without OAuth, next to one it changes nothing",
    (name) => {
      vi.spyOn(console, "warn").mockImplementation(() => {})
      expect(fromEnv({ [name]: "https://kc.example.com" })).toBeUndefined()
      expect(fromEnv({ ...KEYCLOAK, [name]: "https://x.example/mcp" })?.oauthMetadata.issuer).toBe(
        "https://kc.example.com/realms/platform",
      )
    },
  )

  // The boot reads the env it was handed; a variable only process.env holds is not its setting.
  it("reads the env it is handed, not process.env", () => {
    vi.stubEnv("MCP_OAUTH", "{}")
    expect(fromEnv(AUTH0)?.oauthMetadata.issuer).toBe("https://tenant.auth0.com/")
  })

  it("refuses the same without building a provider in refuseOAuthEnv", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(() => refuseOAuthEnv({ MCP_OAUTH: "{}" })).toThrow(/^MCP_OAUTH is no longer read/)
    expect(() => refuseOAuthEnv({ MCP_OAUTH_X: "1" })).not.toThrow()
    expect(() => refuseOAuthEnv({ ...KEYCLOAK, MCP_OAUTH_DEBUG: "1" })).not.toThrow()
    expect(warn).not.toHaveBeenCalled()
  })

  it("refuses the variables of two providers, naming both", () => {
    expect(() => fromEnv({ ...KEYCLOAK, ...AUTH0 })).toThrow(
      "OAuth variables of more than one provider are set: Keycloak (MCP_OAUTH_KEYCLOAK_SERVER_URL, MCP_OAUTH_KEYCLOAK_REALM), Auth0 (MCP_OAUTH_AUTH0_DOMAIN). Keep the variables of one provider and unset the others.",
    )
  })

  it("refuses an incomplete provider, naming the variable that is unset", () => {
    expect(() => fromEnv({ MCP_OAUTH_KEYCLOAK_REALM: "platform" })).toThrow(
      "Keycloak OAuth needs MCP_OAUTH_KEYCLOAK_SERVER_URL and MCP_OAUTH_KEYCLOAK_REALM, but MCP_OAUTH_KEYCLOAK_SERVER_URL is unset.",
    )
    expect(() => fromEnv({ ...KEYCLOAK, MCP_OAUTH_KEYCLOAK_REALM: " " })).toThrow(
      /but MCP_OAUTH_KEYCLOAK_REALM is unset\.$/,
    )
  })

  it("refuses a value the provider cannot honor, with the provider's error as the cause", () => {
    let thrown: unknown
    try {
      fromEnv({ ...KEYCLOAK, MCP_OAUTH_KEYCLOAK_SERVER_URL: "http://kc.internal:8080" })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    const error = thrown as Error
    expect(error.message).toBe(
      "Keycloak OAuth (MCP_OAUTH_KEYCLOAK_SERVER_URL, MCP_OAUTH_KEYCLOAK_REALM) is invalid: Keycloak serverUrl must use HTTPS, or HTTP for localhost, without credentials, query, or fragment",
    )
    expect(error.cause).toBeInstanceOf(Error)
    expect((error.cause as Error).message).toBe(
      "Keycloak serverUrl must use HTTPS, or HTTP for localhost, without credentials, query, or fragment",
    )
  })
})
