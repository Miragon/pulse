import { describe, expect, it } from "vitest"
import {
  describeOAuthTokens,
  oauthAuth0Provider,
  oauthBetterAuthProvider,
  oauthConvexProvider,
  oauthKeycloakProvider,
  oauthWorkOSProvider,
  type OAuthProvider,
} from "./oauth-providers.js"

/** The provider table: what each IdP's value becomes, what is refused, and the subject mapping. */

describe("the provider table", () => {
  it.each<[string, () => OAuthProvider, string, string | undefined]>([
    [
      "Auth0",
      () => oauthAuth0Provider({ domain: "t.auth0.com" }),
      "https://t.auth0.com/",
      undefined,
    ],
    [
      "WorkOS",
      () => oauthWorkOSProvider({ subdomain: "a.authkit.app" }),
      "https://a.authkit.app",
      undefined,
    ],
    [
      "Better Auth",
      () => oauthBetterAuthProvider({ authURL: "https://a.example/api/auth/" }),
      "https://a.example/api/auth",
      "https://a.example/api/auth/jwks",
    ],
    [
      "Convex",
      () => oauthConvexProvider({ authURL: "https://c.example" }),
      "https://c.example",
      "https://c.example/.well-known/jwks.json",
    ],
  ])("builds %s from its value", (_name, build, issuer, jwksUri) => {
    const { oauthMetadata } = build()
    expect(oauthMetadata.issuer).toBe(issuer)
    expect(oauthMetadata.jwks_uri).toBe(jwksUri)
    expect(oauthMetadata.code_challenge_methods_supported).toEqual(["S256"])
  })

  it.each<[string, () => unknown, string]>([
    [
      "a blank realm",
      () => oauthKeycloakProvider({ serverUrl: "https://kc", realm: " " }),
      "Keycloak realm is invalid",
    ],
    [
      "a realm with a slash",
      () => oauthKeycloakProvider({ serverUrl: "https://kc", realm: "a/b" }),
      "Keycloak realm is invalid",
    ],
    [
      "a WorkOS value with a path",
      () => oauthWorkOSProvider({ subdomain: "https://a.example/x" }),
      "WorkOS subdomain must be a hostname or HTTPS origin",
    ],
    [
      "a URL that does not parse",
      () => oauthAuth0Provider({ domain: "https://[" }),
      "Auth0 domain must be an absolute HTTP(S) URL",
    ],
    [
      "credentials in the URL",
      () => oauthConvexProvider({ authURL: "https://u:p@c.example" }),
      "Convex authURL must use HTTPS, or HTTP for localhost, without credentials, query, or fragment",
    ],
  ])("refuses %s", (_case, build, message) => {
    expect(build).toThrow(message)
  })

  // What the web app's sign-in asks each IdP for: Keycloak no offline token, Auth0 a refresh token
  // and the API by `audience`, the others what their metadata lists.
  it.each<[string, () => OAuthProvider, OAuthProvider["web"]]>([
    [
      "Keycloak",
      () => oauthKeycloakProvider({ serverUrl: "https://kc", realm: "r" }),
      { scopes: ["openid", "profile"] },
    ],
    [
      "Auth0",
      () => oauthAuth0Provider({ domain: "t.auth0.com" }),
      { scopes: ["openid", "profile", "offline_access"], audience: "resource" },
    ],
    [
      "WorkOS",
      () => oauthWorkOSProvider({ subdomain: "a.authkit.app" }),
      { scopes: ["openid", "profile", "email", "offline_access"] },
    ],
    [
      "Better Auth",
      () => oauthBetterAuthProvider({ authURL: "https://a.example/api/auth" }),
      { scopes: ["openid", "profile", "email", "offline_access"] },
    ],
    [
      "Convex",
      () => oauthConvexProvider({ authURL: "https://c.example" }),
      { scopes: ["openid", "profile", "email", "offline_access"] },
    ],
  ])("gives %s the web sign-in's scopes", (_name, build, web) => {
    expect(build().web).toEqual(web)
  })

  // What the boot logs: an IdP set up for another audience or caller claim gets 401 on every call.
  it("describes what a token must carry, in the provider's words where it has them", () => {
    const resource = new URL("https://mcp.example.com/mcp")
    const keycloak = oauthKeycloakProvider({ serverUrl: "https://kc", realm: "r" })
    expect(describeOAuthTokens(keycloak, resource)).toBe(
      "OAuth: tokens must carry aud https://mcp.example.com/mcp (RFC 8707) and the sub, sid and auth_time claims of a signed-in user.",
    )
    expect(describeOAuthTokens(oauthAuth0Provider({ domain: "t.auth0.com" }), resource)).toBe(
      "OAuth: tokens must carry aud https://mcp.example.com/mcp (RFC 8707) and a sub claim.",
    )
    const own: OAuthProvider = {
      ...keycloak,
      describeAudience: (bound) => `aud 0000 or ${bound.href}`,
      describeCaller: () => "an oid or sub claim",
    }
    expect(describeOAuthTokens(own, resource)).toBe(
      "OAuth: tokens must carry aud 0000 or https://mcp.example.com/mcp and an oid or sub claim.",
    )
  })

  // A provider that names its caller claims and no words for them: the line names those claims.
  it.each([
    [["oid", "sub"], "an oid or sub claim"],
    [["email", "sub"], "an email or sub claim"],
    [["preferred_username"], "a preferred_username claim"],
  ])("names the caller claims %j as %s", (callerClaims, words) => {
    const auth0 = oauthAuth0Provider({ domain: "t.auth0.com" })
    expect(describeOAuthTokens({ ...auth0, callerClaims }, new URL("https://m/mcp"))).toBe(
      `OAuth: tokens must carry aud https://m/mcp (RFC 8707) and ${words}.`,
    )
  })

  it("maps no payload or no subject to an invalid token", () => {
    const provider = oauthAuth0Provider({ domain: "t.auth0.com" })
    const info = { token: "t", clientId: "c", scopes: [] }
    expect(() => provider.mapAuthInfo(info)).toThrow("Verified token payload is missing")
    expect(() => provider.mapAuthInfo({ ...info, extra: { payload: {} } })).toThrow(
      "Missing Auth0 subject",
    )
    const mapped = provider.mapAuthInfo({
      ...info,
      extra: { payload: { sub: "s", permissions: "a b" } },
    })
    expect(mapped).toEqual({
      user: { id: "s" },
      payload: { sub: "s", permissions: "a b" },
      permissions: ["a", "b"],
    })
  })
})
