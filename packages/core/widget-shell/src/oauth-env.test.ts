import { afterEach, describe, expect, it, vi } from "vitest"
import { OAUTH_DEBUG_ENV_VAR, OAUTH_ENV_VARS, oauthFromEnv } from "./oauth-env.js"
import { describeOAuthTokens } from "./oauth-providers.js"

const KEYCLOAK = {
  MCP_OAUTH_KEYCLOAK_SERVER_URL: "https://kc.example.com",
  MCP_OAUTH_KEYCLOAK_REALM: "platform",
}
const AUTH0 = { MCP_OAUTH_AUTH0_DOMAIN: "tenant.auth0.com" }
const OIDC = { MCP_OAUTH_OIDC_ISSUER: "https://fs.example.com/adfs" }

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
  it("reads exactly the variables of the provider table, the generic provider and Entra ID, and its debug switch", () => {
    expect(OAUTH_ENV_VARS).toEqual([
      "MCP_OAUTH_KEYCLOAK_SERVER_URL",
      "MCP_OAUTH_KEYCLOAK_REALM",
      "MCP_OAUTH_AUTH0_DOMAIN",
      "MCP_OAUTH_WORKOS_SUBDOMAIN",
      "MCP_OAUTH_BETTER_AUTH_URL",
      "MCP_OAUTH_CONVEX_AUTH_URL",
      "MCP_OAUTH_OIDC_ISSUER",
      "MCP_OAUTH_OIDC_AUDIENCE",
      "MCP_OAUTH_OIDC_SCOPES",
      "MCP_OAUTH_OIDC_SUBJECT_CLAIM",
      "MCP_OAUTH_OIDC_ALGORITHMS",
      "MCP_OAUTH_OIDC_CLIENT_IDS",
      "MCP_OAUTH_OIDC_REQUIRED_CLAIMS",
      "MCP_OAUTH_ENTRA_TENANT_ID",
      "MCP_OAUTH_ENTRA_API_CLIENT_ID",
      "MCP_OAUTH_ENTRA_SCOPE",
      "MCP_OAUTH_ENTRA_APP_ID_URI",
      "MCP_OAUTH_ENTRA_AUTHORITY",
      "MCP_OAUTH_ENTRA_CLIENT_IDS",
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
    expect(fromEnv({ MCP_LOG_LEVEL: "info", MCP_URL: "https://x", MCP_API_KEY: "k" })).toBe(
      undefined,
    )
    expect(warn).toHaveBeenCalledTimes(3)
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

  // The web app signs in through the provider the variables name, with that provider's scopes.
  it.each([
    [KEYCLOAK, { scopes: ["openid", "profile"] }],
    [AUTH0, { scopes: ["openid", "profile", "offline_access"], audience: "resource" }],
    [
      { MCP_OAUTH_WORKOS_SUBDOMAIN: "acme.authkit.app" },
      { scopes: ["openid", "profile", "email", "offline_access"] },
    ],
  ])("builds the provider %j with the web sign-in's scopes", (env, web) => {
    expect(fromEnv(env)?.web).toEqual(web)
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

describe("oauthFromEnv: the generic OpenID Connect provider", () => {
  const RESOURCE = new URL("https://pulse.example.com/mcp")
  const line = (env: NodeJS.ProcessEnv) => describeOAuthTokens(fromEnv(env)!, RESOURCE)

  it("builds it from the issuer alone, its issuer exactly as named", () => {
    const provider = fromEnv({
      MCP_OAUTH_OIDC_ISSUER: " https://auth.example.com/application/o/pulse/ ",
    })
    expect(provider?.oauthMetadata).toEqual({
      issuer: "https://auth.example.com/application/o/pulse/",
    })
    expect(provider?.callerClaims).toEqual(["sub"])
    expect(line(OIDC)).toBe(
      "OAuth: tokens must carry aud https://pulse.example.com/mcp (RFC 8707) and the sub claim.",
    )
  })

  it("reads its optional variables, a blank one as unset, and adds the web client to its allowlist", () => {
    const env = {
      ...OIDC,
      MCP_OAUTH_OIDC_AUDIENCE: "pulse-api",
      MCP_OAUTH_OIDC_SCOPES: "pulse.mcp",
      MCP_OAUTH_OIDC_SUBJECT_CLAIM: "uid",
      MCP_OAUTH_OIDC_ALGORITHMS: " ",
      MCP_OAUTH_OIDC_CLIENT_IDS: "claude",
      MCP_WEB_CLIENT_ID: " pulse-web ",
    }
    expect(fromEnv(env)?.requiredScopes).toEqual(["pulse.mcp"])
    expect(line(env)).toBe(
      "OAuth: tokens must carry aud https://pulse.example.com/mcp (RFC 8707) or pulse-api, the scope pulse.mcp, a client id claude or pulse-web and the uid claim.",
    )
  })

  it("logs what its discovery misses under the boot's name", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const issuer = "http://127.0.0.1:1/adfs"
    const provider = fromEnv({ MCP_OAUTH_OIDC_ISSUER: issuer })
    expect(await provider?.discovery?.keys()).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(
      `[test-root] OAuth: the discovery of ${issuer} failed: no answer (unreachable). Until it answers, /mcp answers 503 (temporarily_unavailable).`,
    )
  })

  it("names its missing issuer when only optional variables are set", () => {
    expect(() => fromEnv({ MCP_OAUTH_OIDC_AUDIENCE: "https://x.example.com" })).toThrow(
      "OpenID Connect OAuth needs MCP_OAUTH_OIDC_ISSUER, which is unset while MCP_OAUTH_OIDC_AUDIENCE is set.",
    )
    const two = { MCP_OAUTH_OIDC_SCOPES: "a", MCP_OAUTH_OIDC_SUBJECT_CLAIM: "uid" }
    expect(() => fromEnv(two)).toThrow(
      "OpenID Connect OAuth needs MCP_OAUTH_OIDC_ISSUER, which is unset while MCP_OAUTH_OIDC_SCOPES and MCP_OAUTH_OIDC_SUBJECT_CLAIM are set.",
    )
  })

  it("refuses it beside a table provider, naming the variables of each that are set", () => {
    expect(() => fromEnv({ ...KEYCLOAK, ...OIDC, MCP_OAUTH_OIDC_SCOPES: "a" })).toThrow(
      "OAuth variables of more than one provider are set: Keycloak (MCP_OAUTH_KEYCLOAK_SERVER_URL, MCP_OAUTH_KEYCLOAK_REALM), OpenID Connect (MCP_OAUTH_OIDC_ISSUER, MCP_OAUTH_OIDC_SCOPES). Keep the variables of one provider and unset the others.",
    )
  })

  it("refuses a value it cannot honor, naming the variables that are set", () => {
    expect(() => fromEnv({ ...OIDC, MCP_OAUTH_OIDC_SUBJECT_CLAIM: "email" })).toThrow(
      'OpenID Connect OAuth (MCP_OAUTH_OIDC_ISSUER, MCP_OAUTH_OIDC_SUBJECT_CLAIM) is invalid: MCP_OAUTH_OIDC_SUBJECT_CLAIM "email" names a claim whose value can change',
    )
  })
})

describe("oauthFromEnv: Microsoft Entra ID", () => {
  const RESOURCE = new URL("https://pulse.example.com/mcp")
  const TENANT = "4f1b6d0e-2c3a-4e5f-8a9b-0c1d2e3f4a5b"
  const API = "7d2e9c41-6b3f-4a8e-9f10-2b3c4d5e6f70"
  const ENTRA = { MCP_OAUTH_ENTRA_TENANT_ID: TENANT, MCP_OAUTH_ENTRA_API_CLIENT_ID: API }
  const AUTHORITY = `https://login.microsoftonline.com/${TENANT}`

  it("builds it from the tenant and the API, its metadata the tenant's oauth21 authority", () => {
    const provider = fromEnv(ENTRA)
    expect(provider?.oauthMetadata).toEqual({ issuer: `${AUTHORITY}/oauth21/2026-08` })
    expect(provider?.requiredScopes).toEqual([`api://${API}/user_impersonation`])
    expect(provider?.web?.discoveryIssuer).toBe(`${AUTHORITY}/v2.0`)
    const extra = provider?.mapAuthInfo(verified({ oid: "o-1", sub: "s-1", roles: ["Admin"] }))
    expect(extra).toMatchObject({ user: { id: "o-1" }, permissions: ["Admin"] })
  })

  it("reads its optional variables, a blank one as unset, and adds the web client to its allowlist", () => {
    const env = {
      ...ENTRA,
      MCP_OAUTH_ENTRA_SCOPE: " access_as_user ",
      MCP_OAUTH_ENTRA_APP_ID_URI: "https://pulse.example.com/mcp",
      MCP_OAUTH_ENTRA_AUTHORITY: "https://login.microsoftonline.us",
      MCP_OAUTH_ENTRA_CLIENT_IDS: "aebc6443-996d-45c2-90f0-388ff96faa56",
      MCP_WEB_CLIENT_ID: "pulse-web",
      MCP_OAUTH_OIDC_ISSUER: " ",
    }
    const provider = fromEnv(env)
    expect(provider?.requiredScopes).toEqual(["https://pulse.example.com/mcp/access_as_user"])
    expect(describeOAuthTokens(provider!, RESOURCE)).toBe(
      `OAuth: tokens must carry iss https://login.microsoftonline.us/${TENANT}/v2.0 or https://login.microsoftonline.us/${TENANT}/oauth21/2026-08, aud ${API} or https://pulse.example.com/mcp (RFC 8707), ver 2.0, the scope https://pulse.example.com/mcp/access_as_user, a client id aebc6443-996d-45c2-90f0-388ff96faa56 or pulse-web and an oid or sub claim.`,
    )
  })

  it("names what it misses: both required variables, or the one that is unset", () => {
    expect(() => fromEnv({ MCP_OAUTH_ENTRA_SCOPE: "user_impersonation" })).toThrow(
      "Entra ID OAuth needs MCP_OAUTH_ENTRA_TENANT_ID and MCP_OAUTH_ENTRA_API_CLIENT_ID, which are unset while MCP_OAUTH_ENTRA_SCOPE is set.",
    )
    expect(() => fromEnv({ MCP_OAUTH_ENTRA_TENANT_ID: TENANT })).toThrow(
      "Entra ID OAuth needs MCP_OAUTH_ENTRA_TENANT_ID and MCP_OAUTH_ENTRA_API_CLIENT_ID, but MCP_OAUTH_ENTRA_API_CLIENT_ID is unset.",
    )
  })

  it("refuses several tenants, and the generic provider beside it", () => {
    expect(() => fromEnv({ ...ENTRA, MCP_OAUTH_ENTRA_TENANT_ID: "organizations" })).toThrow(
      'Entra ID OAuth (MCP_OAUTH_ENTRA_TENANT_ID, MCP_OAUTH_ENTRA_API_CLIENT_ID) is invalid: MCP_OAUTH_ENTRA_TENANT_ID "organizations" signs in the accounts of every tenant',
    )
    expect(() => fromEnv({ ...ENTRA, ...OIDC })).toThrow(
      "OAuth variables of more than one provider are set: OpenID Connect (MCP_OAUTH_OIDC_ISSUER), Entra ID (MCP_OAUTH_ENTRA_TENANT_ID, MCP_OAUTH_ENTRA_API_CLIENT_ID).",
    )
  })
})

describe("oauthFromEnv: what fails the boot", () => {
  // The typo warner speaks for these: none of them asks this reader for anything.
  it.each([
    "MCP_OAUTH",
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

  it.each([
    ["MCP_OAUTH_OIDC_SCOPE", "MCP_OAUTH_OIDC_SCOPES", "OpenID Connect", "MCP_OAUTH_OIDC_"],
    ["MCP_OAUTH_OIDC_CLIENT_ID", "MCP_OAUTH_OIDC_CLIENT_IDS", "OpenID Connect", "MCP_OAUTH_OIDC_"],
    ["MCP_OAUTH_OIDC_ISUER", "MCP_OAUTH_OIDC_ISSUER", "OpenID Connect", "MCP_OAUTH_OIDC_"],
    // A tie goes to the first: ISSUER and SCOPES are both six edits away.
    ["MCP_OAUTH_OIDC_", "MCP_OAUTH_OIDC_ISSUER", "OpenID Connect", "MCP_OAUTH_OIDC_"],
    ["MCP_OAUTH_ENTRA_SCOPES", "MCP_OAUTH_ENTRA_SCOPE", "Entra ID", "MCP_OAUTH_ENTRA_"],
    ["MCP_OAUTH_ENTRA_CLIENT_ID", "MCP_OAUTH_ENTRA_CLIENT_IDS", "Entra ID", "MCP_OAUTH_ENTRA_"],
    ["MCP_OAUTH_ENTRA_TENANT", "MCP_OAUTH_ENTRA_TENANT_ID", "Entra ID", "MCP_OAUTH_ENTRA_"],
  ])(
    "refuses %s under its provider's prefix, with a provider or without, naming %s",
    (name, meant, provider, prefix) => {
      const refusal = `${name} is no variable the server reads (did you mean ${meant}?): under ${prefix} a misspelled variable would drop a restriction of the ${provider} provider or the provider itself, so the boot refuses it. Correct or unset it.`
      expect(() => fromEnv({ [name]: "pulse" })).toThrow(refusal)
      expect(() => fromEnv({ ...KEYCLOAK, [name]: "pulse" })).toThrow(refusal)
    },
  )

  it("takes a blank variable under such a prefix for unset, as every provider variable", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(fromEnv({ MCP_OAUTH_OIDC_SCOPE: " ", MCP_OAUTH_ENTRA_SCOPES: "" })).toBeUndefined()
  })

  // The boot reads the env it was handed; a variable only process.env holds is not its setting.
  it("reads the env it is handed, not process.env", () => {
    vi.stubEnv("MCP_OAUTH_WORKOS_SUBDOMAIN", "acme.authkit.app")
    expect(fromEnv(AUTH0)?.oauthMetadata.issuer).toBe("https://tenant.auth0.com/")
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
