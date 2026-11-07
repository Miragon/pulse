/**
 * Pulse's OAuth providers: the official SDK has the bearer gate and the discovery documents but no
 * JWT verifier and no IdP table, so this holds the table (Keycloak, Auth0, WorkOS, Better Auth,
 * Convex), each on the one verifier in `oauth-jwt.ts`, and the custom port a root fills itself.
 * The gate in front of `/mcp` is `oauth-gate.ts`.
 */
import type { AuthInfo, OAuthMetadata, OAuthTokenVerifier } from "@modelcontextprotocol/server"
import { createJwtVerifier } from "./oauth-jwt.js"
import {
  invalidToken,
  isAllowedHttpUrl,
  isRecord,
  nonBlank,
  normalizedStrings,
  type Claims,
} from "./oauth-shared.js"

export interface OAuthProvider {
  /** The full public MCP endpoint; else `MCP_URL`'s origin plus the base path. */
  resource?: URL | string
  oauthMetadata: OAuthMetadata
  requiredScopes?: readonly string[]
  createTokenVerifier(resource: URL): OAuthTokenVerifier
  /** Goes under `AuthInfo.extra`; `callerUserId` reads `user.id` and `payload.sub`. */
  mapAuthInfo(authInfo: AuthInfo): {
    user: unknown
    payload: Claims
    permissions: string[]
  }
}

/** What every table provider takes besides its own values. */
export interface ProviderOptions {
  /** `MCP_OAUTH_DEBUG`: log why a token was refused, never the token itself. */
  debug?: boolean
}

/** A root's own IdP (a test's stub, a customer's): the same port the table's five fill. */
export function oauthCustomProvider(options: OAuthProvider): OAuthProvider {
  if (
    typeof options?.createTokenVerifier !== "function" ||
    typeof options.mapAuthInfo !== "function"
  ) {
    throw new TypeError("oauthCustomProvider requires createTokenVerifier and mapAuthInfo")
  }
  if (typeof options.oauthMetadata?.issuer !== "string") {
    throw new TypeError("oauthMetadata must include a string issuer")
  }
  return options
}

const providerUrl = (value: string, name: string): URL => {
  let url: URL
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`)
  } catch {
    throw new TypeError(`${name} must be an absolute HTTP(S) URL`)
  }
  if (!isAllowedHttpUrl(url)) {
    throw new TypeError(
      `${name} must use HTTPS, or HTTP for localhost, without credentials, query, or fragment`,
    )
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/"
  return url
}

const endpoint = (issuer: string, path: string): string => {
  const base = new URL(issuer)
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/`
  return new URL(path, base).href
}

function mapSubject(provider: string) {
  return (authInfo: AuthInfo) => {
    const payload = authInfo.extra?.payload
    if (!isRecord(payload)) throw invalidToken("Verified token payload is missing")
    const id = nonBlank(payload, "sub")
    if (id === undefined) throw invalidToken(`Missing ${provider} subject`)
    return { user: { id }, payload, permissions: normalizedStrings(payload.permissions) }
  }
}

/** The endpoints of one IdP, relative to its issuer; the JWT rules are the same for all five. */
interface IdpTable {
  name: string
  jwks: string
  metadata: Omit<OAuthMetadata, "issuer" | "authorization_endpoint" | "token_endpoint"> & {
    authorization: string
    token: string
    registration: string
    jwksInMetadata?: boolean
    userinfo?: string
    grants?: string[]
    scopes?: string[]
  }
}

function idpProvider(
  issuer: string,
  { name, jwks, metadata }: IdpTable,
  { debug }: ProviderOptions,
): OAuthProvider {
  const { authorization, token, registration, jwksInMetadata, userinfo, grants, scopes } = metadata
  return {
    createTokenVerifier: (resource) =>
      createJwtVerifier({ issuer, jwksUrl: new URL(endpoint(issuer, jwks)), resource, debug }),
    oauthMetadata: {
      issuer,
      authorization_endpoint: endpoint(issuer, authorization),
      token_endpoint: endpoint(issuer, token),
      registration_endpoint: endpoint(issuer, registration),
      ...(jwksInMetadata && { jwks_uri: endpoint(issuer, jwks) }),
      ...(userinfo && { userinfo_endpoint: endpoint(issuer, userinfo) }),
      response_types_supported: ["code"],
      grant_types_supported: grants ?? ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      ...(scopes && { scopes_supported: scopes }),
    },
    mapAuthInfo: mapSubject(name),
  }
}

const withoutSlash = (url: URL) => url.href.replace(/\/$/, "")
const OIDC_SCOPES = ["openid", "profile", "email", "offline_access"]

export function oauthKeycloakProvider({
  serverUrl,
  realm,
  ...options
}: { serverUrl: string; realm: string } & ProviderOptions) {
  if (realm.trim().length === 0 || /[/?#]/.test(realm)) {
    throw new TypeError("Keycloak realm is invalid")
  }
  const issuer = endpoint(
    providerUrl(serverUrl, "Keycloak serverUrl").href,
    `realms/${encodeURIComponent(realm)}`,
  ).replace(/\/$/, "")
  return idpProvider(
    issuer,
    {
      name: "Keycloak",
      jwks: "protocol/openid-connect/certs",
      metadata: {
        authorization: "protocol/openid-connect/auth",
        token: "protocol/openid-connect/token",
        registration: "clients-registrations/openid-connect",
      },
    },
    options,
  )
}

export function oauthAuth0Provider({ domain, ...options }: { domain: string } & ProviderOptions) {
  return idpProvider(
    providerUrl(domain, "Auth0 domain").href,
    {
      name: "Auth0",
      jwks: ".well-known/jwks.json",
      metadata: { authorization: "authorize", token: "oauth/token", registration: "oidc/register" },
    },
    options,
  )
}

export function oauthWorkOSProvider({
  subdomain,
  ...options
}: { subdomain: string } & ProviderOptions) {
  const url = providerUrl(subdomain, "WorkOS subdomain")
  if (url.pathname !== "/") {
    throw new TypeError("WorkOS subdomain must be a hostname or HTTPS origin")
  }
  return idpProvider(
    withoutSlash(url),
    {
      name: "WorkOS",
      jwks: "oauth2/jwks",
      metadata: {
        authorization: "oauth2/authorize",
        token: "oauth2/token",
        registration: "oauth2/register",
      },
    },
    options,
  )
}

export function oauthBetterAuthProvider({
  authURL,
  ...options
}: { authURL: string } & ProviderOptions) {
  return idpProvider(
    withoutSlash(providerUrl(authURL, "Better Auth authURL")),
    {
      name: "Better Auth",
      jwks: "jwks",
      metadata: {
        authorization: "oauth2/authorize",
        token: "oauth2/token",
        registration: "oauth2/register",
        jwksInMetadata: true,
        grants: ["authorization_code", "client_credentials", "refresh_token"],
        scopes: OIDC_SCOPES,
      },
    },
    options,
  )
}

export function oauthConvexProvider({
  authURL,
  ...options
}: { authURL: string } & ProviderOptions) {
  return idpProvider(
    withoutSlash(providerUrl(authURL, "Convex authURL")),
    {
      name: "Convex",
      jwks: ".well-known/jwks.json",
      metadata: {
        authorization: "authorize",
        token: "token",
        registration: "register",
        jwksInMetadata: true,
        userinfo: "userinfo",
        scopes: OIDC_SCOPES,
      },
    },
    options,
  )
}
