import { describe, expect, it } from "vitest"
import {
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
