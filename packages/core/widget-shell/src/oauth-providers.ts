/**
 * Pulse's OAuth providers: the official SDK has the bearer gate and the discovery documents but no
 * JWT verifier and no IdP table, so this holds the port, the table (Keycloak, Auth0, WorkOS, Better
 * Auth, Convex), each on the one verifier in `oauth-jwt.ts`, and the custom port a root fills
 * itself. The generic OpenID Connect provider is `oauth-oidc.ts`; the gate in front of `/mcp` is
 * `oauth-gate.ts`.
 */
import type { AuthInfo, OAuthMetadata, OAuthTokenVerifier } from "@modelcontextprotocol/server"
import type { ProviderDiscovery } from "./oauth-discovery.js"
import { createJwtVerifier } from "./oauth-jwt.js"
import {
  callerOf,
  DEFAULT_CALLER_CLAIMS,
  invalidToken,
  isAllowedHttpUrl,
  isRecord,
  normalizedStrings,
  type Claims,
} from "./oauth-shared.js"

/**
 * What the web app's sign-in asks the provider for (`MCP_WEB_*`) and where: the scopes, and for a
 * provider that names a token's API by `audience` (Auth0) rather than by RFC 8707's `resource`
 * alone, `audience: "resource"`, which sends the gate's resource as the audience too. The token must
 * pass the gate either way. Unset, the other options keep the sign-in as every table provider has
 * it: the provider's issuer, the gate's resource at the authorization request, the code exchange
 * and every refresh, and the scopes at the authorization request alone.
 */
export interface OAuthWebClient {
  readonly scopes: readonly string[]
  readonly audience?: "resource"
  /**
   * The issuer the sign-in discovers and signs in through, where it is not the one the protected
   * resource metadata names (Entra ID: its v2.0 authority, while MCP clients read its oauth21
   * one); a callback's `iss` must name it.
   */
  readonly discoveryIssuer?: string
  /**
   * `false`: the sign-in names no resource (RFC 8707) anywhere, for a provider that names a token's
   * API by its scope and refuses a resource it does not know (Entra ID, AADSTS9010010).
   */
  readonly resource?: false
  /**
   * `true`: the code exchange and every refresh name the scopes too, for a provider that refuses a
   * code exchange without them (Entra ID, AADSTS28003) or would renew a token for another API.
   */
  readonly grantScopes?: true
}

/**
 * The authorization server as the provider names it: its RFC 8414 metadata, which the server
 * serves a copy of at `/.well-known/oauth-authorization-server`, or its issuer alone, which only
 * the protected resource metadata names (that path then answers 404, and clients read the
 * provider's own documents).
 */
export type OAuthServerMetadata = Partial<OAuthMetadata> & Pick<OAuthMetadata, "issuer">

export interface OAuthProvider {
  /** The full public MCP endpoint; else `MCP_URL`'s origin plus the base path. */
  resource?: URL | string
  oauthMetadata: OAuthServerMetadata
  /** The scopes the gate requires of every token, as the token carries them. */
  requiredScopes?: readonly string[]
  /**
   * The required scopes as a client asks for them, which the protected resource metadata names in
   * `scopes_supported` (never `offline_access`); default the `requiredScopes`.
   */
  scopesSupported?: readonly string[]
  /**
   * The claims that name the caller, the first a token carries; default `sub`. The web sign-in
   * takes an ID token's name only where it names the same caller by them.
   */
  callerClaims?: readonly string[]
  /** The boot line's words for what `aud` must hold; default `aud <resource> (RFC 8707)`. */
  describeAudience?(resource: URL): string
  /** The boot line's words for the claims that name the caller; default by the `callerClaims`. */
  describeCaller?(): string
  /**
   * The web app's sign-in; a provider without it signs in with the scope `openid`. Either way the
   * sign-in also asks for the `requiredScopes`, which the gate checks a session's token for.
   */
  web?: OAuthWebClient
  /**
   * The provider's one discovery of its issuer at this replica, where its gate reads its key set
   * from it: the web sign-in then reads the provider's metadata from the same discovery instead of
   * one of its own.
   */
  discovery?: ProviderDiscovery
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

/** The caller claims as the boot line names them: `a sub claim`, `an oid or sub claim`. */
function callerClaimsText(claims: readonly string[]): string {
  const named = claims.join(" or ")
  return `${/^[aeiou]/i.test(named) ? "an" : "a"} ${named} claim`
}

/** The boot's line on what a token must carry, in the provider's own words where it has them. */
export function describeOAuthTokens(provider: OAuthProvider, resource: URL): string {
  const audience = provider.describeAudience?.(resource) ?? `aud ${resource.href} (RFC 8707)`
  const caller =
    provider.describeCaller?.() ?? callerClaimsText(provider.callerClaims ?? DEFAULT_CALLER_CLAIMS)
  return `OAuth: tokens must carry ${audience} and ${caller}.`
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

/** The caller by the provider's rule: the value of the first caller claim the token carries. */
export function mapSubject(provider: string, callerClaims: readonly string[]) {
  return (authInfo: AuthInfo) => {
    const payload = authInfo.extra?.payload
    if (!isRecord(payload)) throw invalidToken("Verified token payload is missing")
    const id = callerOf(payload, callerClaims)
    if (id === undefined) throw invalidToken(`Missing ${provider} subject`)
    return { user: { id }, payload, permissions: normalizedStrings(payload.permissions) }
  }
}

/**
 * The endpoints of one IdP, relative to its issuer; the JWT rules are the same for all five: one
 * key set at a fixed path, the resource the one audience, `sub` the caller, every algorithm the
 * set's keys name.
 */
interface IdpTable {
  name: string
  jwks: string
  web: OAuthWebClient
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
  { name, jwks, web, metadata }: IdpTable,
  { debug }: ProviderOptions,
): OAuthProvider {
  const { authorization, token, registration, jwksInMetadata, userinfo, grants, scopes } = metadata
  return {
    web,
    createTokenVerifier: (resource) =>
      createJwtVerifier({
        keySets: [{ issuer, jwks: new URL(endpoint(issuer, jwks)) }],
        resource,
        debug,
      }),
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
    mapAuthInfo: mapSubject(name, DEFAULT_CALLER_CLAIMS),
  }
}

const withoutSlash = (url: URL) => url.href.replace(/\/$/, "")
const OIDC_SCOPES = ["openid", "profile", "email", "offline_access"]

/**
 * The web sign-in's scopes per IdP. Keycloak renews a session's token without `offline_access`,
 * which would mint a long-lived offline token; Auth0 issues a refresh token only with it, and names
 * the API by `audience`; the other three ask for what their metadata lists.
 */
const KEYCLOAK_WEB: OAuthWebClient = { scopes: ["openid", "profile"] }
const AUTH0_WEB: OAuthWebClient = {
  scopes: ["openid", "profile", "offline_access"],
  audience: "resource",
}
const OIDC_WEB: OAuthWebClient = { scopes: OIDC_SCOPES }

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
      web: KEYCLOAK_WEB,
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
      web: AUTH0_WEB,
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
      web: OIDC_WEB,
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
      web: OIDC_WEB,
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
      web: OIDC_WEB,
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
