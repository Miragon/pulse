import { afterEach, describe, expect, it, vi } from "vitest"
import { OAUTH_ENV_VARS, oauthFromEnv } from "./oauth-env.js"

const KEYCLOAK = { provider: "keycloak", serverUrl: "https://kc.example.com", realm: "platform" }

/** `oauthFromEnv` over a given `MCP_OAUTH` value (an object is JSON-encoded). */
const fromEnv = (raw: string | object | undefined) =>
  oauthFromEnv({
    env: { MCP_OAUTH: typeof raw === "object" ? JSON.stringify(raw) : raw },
    label: "test-root",
  })

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("oauthFromEnv", () => {
  it("names the one env var it reads", () => {
    expect(OAUTH_ENV_VARS).toEqual(["MCP_OAUTH"])
  })

  it("installs nothing when MCP_OAUTH is unset or blank — and says what that means, once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    for (const raw of [undefined, "", "   "]) expect(fromEnv(raw)).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(3)
    expect(warn.mock.calls[0][0]).toMatch(
      /^\[test-root\] MCP_OAUTH is unset — there is no caller identity/,
    )
    expect(warn.mock.calls[0][0]).toContain("user settings cannot be saved")
  })

  it("reads process.env by default", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.stubEnv("MCP_OAUTH", JSON.stringify(KEYCLOAK))
    expect(oauthFromEnv()?.oauthMetadata.issuer).toBe("https://kc.example.com/realms/platform")
  })

  // Exact values: swapped serverUrl/realm would still construct.
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

  it("maps the token subject as the caller id (`user.id`, the spelling resolveCaller reads)", () => {
    const extra = fromEnv(KEYCLOAK)!.mapAuthInfo({
      token: "t",
      clientId: "c",
      scopes: [],
      extra: { payload: { sub: "user-123", realm_access: { roles: [] } } },
    })
    expect(extra.user).toMatchObject({ id: "user-123" })
    expect(extra.user).not.toHaveProperty("userId")
  })

  it("builds an Auth0 provider from the bare tenant domain", () => {
    const provider = fromEnv({ provider: "auth0", domain: "tenant.auth0.com" })
    expect(provider?.oauthMetadata.issuer).toBe("https://tenant.auth0.com/")
    expect(provider?.oauthMetadata.authorization_endpoint).toBe(
      "https://tenant.auth0.com/authorize",
    )
    expect(provider?.oauthMetadata.token_endpoint).toBe("https://tenant.auth0.com/oauth/token")
  })

  it("rejects a scheme-prefixed auth0 domain at boot instead of 401ing later", () => {
    expect(() => fromEnv({ provider: "auth0", domain: "https://tenant.auth0.com" })).toThrow(
      /bare hostname/,
    )
    expect(() => fromEnv({ provider: "auth0", domain: "tenant.auth0.com/x" })).toThrow(
      /bare hostname/,
    )
  })

  it("rejects invalid JSON with an actionable message", () => {
    expect(() => fromEnv("keycloak")).toThrow(/MCP_OAUTH is not valid JSON/)
  })

  it("rejects unknown providers, missing fields and keys it would not honor", () => {
    expect(() => fromEnv({ provider: "okta" })).toThrow(/MCP_OAUTH is invalid/)
    expect(() => fromEnv({ provider: "oidc", issuer: "https://idp.example.com" })).toThrow(
      /MCP_OAUTH is invalid/,
    )
    expect(() => fromEnv({ provider: "keycloak", serverUrl: "https://kc.example.com" })).toThrow(
      /realm/,
    )
    expect(() => fromEnv({ ...KEYCLOAK, serverUrl: "not a url" })).toThrow(/serverUrl/)
    expect(() => fromEnv({ ...KEYCLOAK, realm: "" })).toThrow(/realm/)
    // An audience mcp-use 2 cannot check must fail loudly, not be dropped.
    expect(() => fromEnv({ ...KEYCLOAK, audience: "https://mcp.example.com/mcp" })).toThrow(
      /audience/,
    )
  })

  it("fails fast when stray MCP_USE_OAUTH_* env vars could silently alter the config", () => {
    vi.stubEnv("MCP_USE_OAUTH_KEYCLOAK_AUDIENCE", "https://other-api.example.com")
    expect(() => fromEnv(KEYCLOAK)).toThrow(/unset MCP_USE_OAUTH_KEYCLOAK_AUDIENCE/)
  })
})
