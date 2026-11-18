/**
 * Microsoft Entra ID for one tenant (`MCP_OAUTH_ENTRA_*`): the gate takes the tenant's v2 access
 * tokens for the API registration, and the web app signs in through the tenant's v2.0 authority.
 *
 * The gate verifies the tokens of two issuers of the tenant, each against its own key set and only
 * with the keys tagged for it (Microsoft's signing-key issuer rule): the GA v2.0 authority's
 * (`<authority>/<tenant>/v2.0` over `<authority>/<tenant>/discovery/v2.0/keys`) and the
 * `oauth21/2026-08` authority's (over its own `/keys`, whose keys name that authority, the same keys
 * or others), so an oauth21 token verifies only with a key tagged for oauth21. `aud` names the
 * API's client id (a v2 token's) or an App ID URI the operator names for the API, the gate's
 * resource only where it is one of them (another app of the tenant may own that URI otherwise);
 * `ver` is 2.0, and a v1
 * token (`ver` 1.0, the issuer `https://sts.windows.net/<tenant>/`) is refused with the way out,
 * `requestedAccessTokenVersion` 2; a `tid`, where the token carries one, names the tenant. The
 * required scope is `<first App ID URI>/<scope>`, read from the short `scp` a v2 token carries, and a
 * token without `scp` (an app-only token, an ID token) names no signed-in user: 401. The caller is
 * `oid`, else `sub` (Microsoft issues `oid` and `tid` only where `profile` was asked, which MCP
 * clients do not ask); `roles` are the permissions. The protected resource metadata names the
 * oauth21 authority, the one whose metadata names PKCE's methods, which MCP clients require, and
 * there is no copy of the authorization server's metadata. A client allowlist names a GUID in lower
 * case, as `azp` does, however the variable spells it.
 *
 * The web sign-in discovers the v2.0 authority, names no resource (Entra ID refuses one that is no
 * App ID URI of the API, AADSTS9010010) and asks `openid profile offline_access` and the required
 * scope at the authorization request, the code exchange and every refresh. Its sign-out goes to the
 * v2.0 authority's end of the session; Entra ID has no revocation endpoint, so nothing is revoked.
 *
 * The boot refuses a tenant that is no tenant id (`common`, `organizations`, `consumers` and a
 * domain name) or no customer's (the ids of the personal accounts' tenant and of Microsoft's own
 * services), an API client id that is no GUID, a scope that is no short scope name, an App ID URI
 * off `api:` and `https:` and an authority that is no Entra ID cloud (http only on the machine
 * itself, for tests).
 */
import type { AuthInfo, OAuthTokenVerifier } from "@modelcontextprotocol/server"
import { decodeJwt } from "jose"
import { createJwtVerifier, type JwtKeySet } from "./oauth-jwt.js"
import { listOf } from "./oauth-oidc.js"
import { mapSubject, type OAuthProvider, type ProviderOptions } from "./oauth-providers.js"
import { invalidToken, isLocalHostname, normalizedStrings, type Claims } from "./oauth-shared.js"

/** The provider's variables: the tenant and the API's client id are required, the others optional. */
export const ENTRA_ENV = {
  tenantId: "MCP_OAUTH_ENTRA_TENANT_ID",
  apiClientId: "MCP_OAUTH_ENTRA_API_CLIENT_ID",
  scope: "MCP_OAUTH_ENTRA_SCOPE",
  appIdUri: "MCP_OAUTH_ENTRA_APP_ID_URI",
  authority: "MCP_OAUTH_ENTRA_AUTHORITY",
  clientIds: "MCP_OAUTH_ENTRA_CLIENT_IDS",
} as const

/** The values of the optional variables, each `undefined` when unset. */
type EntraValues = Readonly<
  Partial<Record<Exclude<keyof typeof ENTRA_ENV, "tenantId" | "apiClientId">, string>>
>

interface EntraSettings {
  /** The tenant's id, in lower case as its tokens name it. */
  readonly tenant: string
  /** The API registration's client id, in lower case: a v2 token's `aud`. */
  readonly apiClientId: string
  /** The scope the API exposes, short as `scp` carries it. */
  readonly scope: string
  /** The API's App ID URIs the operator names, each an `aud` it takes; the first names the scope. */
  readonly appIdUris: readonly string[]
  /** The cloud's origin. */
  readonly authority: string
  /**
   * The clients whose tokens pass, the web sign-in's among them, a GUID in lower case as `azp`
   * names it; unset, every client's.
   */
  readonly clients?: readonly string[]
}

const GUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

/** The tenants that are no tenant: every work account's, and personal Microsoft accounts. */
const MULTI_TENANT: ReadonlySet<string> = new Set(["common", "organizations", "consumers"])

/**
 * Tenant ids no customer's API lives in: the tenant of every personal Microsoft account (what
 * `consumers` signs in, its tokens' `tid`) and the tenant of Microsoft's own first-party services.
 */
const NO_CUSTOMER_TENANT: ReadonlyMap<string, string> = new Map([
  [
    "9188040d-6c67-4c5b-b112-36a304b66dad",
    "the tenant of every personal Microsoft account (consumers)",
  ],
  ["f8cdef31-a31e-4b4a-93e4-5f571e91255a", "Microsoft's own tenant of its first-party services"],
])

/** Entra ID's clouds: the global one first, the default. */
const CLOUDS = [
  "login.microsoftonline.com",
  "login.microsoftonline.us",
  "login.partner.microsoftonline.cn",
]

/** The oauth21 authority's path below the tenant. */
const OAUTH21 = "oauth21/2026-08"

/** What the web sign-in asks besides the required scope: a refresh token among them. */
const WEB_SCOPES = ["openid", "profile", "offline_access"]

/** The claims that name the caller, the first a token carries. */
const CALLER_CLAIMS = ["oid", "sub"]

/** The schemes of an App ID URI that names a scope (`api://<client id>`, a URL of the API). */
const APP_ID_SCHEMES: ReadonlySet<string> = new Set(["api:", "https:"])

/** A scope token of RFC 6749 §3.3 without a `/`: a scope's short name. */
const SHORT_SCOPE = /^[\x21\x23-\x2e\x30-\x5b\x5d-\x7e]+$/

function tenantOf(raw: string): string {
  const named = raw.toLowerCase()
  const notCustomers = NO_CUSTOMER_TENANT.get(named)
  if (notCustomers !== undefined) {
    throw new Error(
      `${ENTRA_ENV.tenantId} "${named}" is ${notCustomers}, and Pulse serves one ` +
        "organization's tenant: name your tenant's id, a GUID (Microsoft Entra admin center, " +
        "Overview).",
    )
  }
  if (GUID.test(raw)) return named
  if (MULTI_TENANT.has(named)) {
    throw new Error(
      `${ENTRA_ENV.tenantId} "${named}" signs in the accounts of every tenant, and Pulse serves ` +
        "one tenant: name your tenant's id, a GUID (Microsoft Entra admin center, Overview).",
    )
  }
  throw new Error(
    `${ENTRA_ENV.tenantId} must be your tenant's id, a GUID (Microsoft Entra admin center, ` +
      "Overview): its tokens name the tenant by its id, never by a domain name.",
  )
}

function apiClientIdOf(raw: string): string {
  if (GUID.test(raw)) return raw.toLowerCase()
  throw new Error(
    `${ENTRA_ENV.apiClientId} must be the API registration's Application (client) ID, a GUID: ` +
      "the aud of its v2 access tokens.",
  )
}

function scopeOf(raw: string | undefined): string {
  if (raw === undefined) return "user_impersonation"
  if (SHORT_SCOPE.test(raw) && raw !== ".default") return raw
  throw new Error(
    `${ENTRA_ENV.scope} must name one scope the API exposes, as tokens carry it in scp ` +
      `(user_impersonation), without its App ID URI, which ${ENTRA_ENV.appIdUri} names.`,
  )
}

function appIdUriOf(raw: string): string {
  const scheme = URL.canParse(raw) && new URL(raw).protocol
  if (APP_ID_SCHEMES.has(String(scheme)) && !/[?#]|\/$/.test(raw)) return raw
  throw new Error(
    `${ENTRA_ENV.appIdUri} must name App ID URIs of the API registration (api://... or ` +
      "https://...) without a query, a fragment or a trailing slash: the API's scopes are named " +
      "<App ID URI>/<scope> by the first.",
  )
}

/** The App ID URIs, by default `api://<API client id>`, the one Entra ID suggests. */
function appIdUrisOf(raw: string | undefined, apiClientId: string): string[] {
  if (raw === undefined) return [`api://${apiClientId}`]
  return [...new Set(listOf(ENTRA_ENV.appIdUri, raw).map(appIdUriOf))]
}

/** A cloud's origin, or the machine itself (a test's identity provider). */
function isAuthority(url: URL): boolean {
  if (isLocalHostname(url.hostname)) return url.protocol === "http:" || url.protocol === "https:"
  return url.protocol === "https:" && url.port === "" && CLOUDS.includes(url.hostname)
}

function authorityOf(raw: string | undefined): string {
  if (raw === undefined) return `https://${CLOUDS[0]}`
  const url = URL.canParse(raw) ? new URL(raw) : undefined
  if (url !== undefined && url.pathname === "/" && isAuthority(url)) return url.origin
  throw new Error(
    `${ENTRA_ENV.authority} must be the origin of an Entra ID cloud: ` +
      `${CLOUDS.map((cloud) => `https://${cloud}`).join(", ")} (http only on localhost, for tests).`,
  )
}

/** A client's id as `azp` names it: a GUID in lower case, any other id as it is. */
const clientIdOf = (raw: string): string => (GUID.test(raw) ? raw.toLowerCase() : raw)

/** The allowlist, and the web sign-in's client on it, whose tokens the gate must take. */
function clientsOf(raw: string | undefined, webClientId: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined
  const web = webClientId === undefined ? [] : [webClientId]
  return [...new Set([...listOf(ENTRA_ENV.clientIds, raw), ...web].map(clientIdOf))]
}

/**
 * The provider's settings from its variables (trimmed, a blank one unset), or the first reason
 * they cannot work. `webClientId` is `MCP_WEB_CLIENT_ID`, which joins a client allowlist.
 */
export function readEntraSettings(
  tenantId: string,
  apiClientId: string,
  values: EntraValues,
  webClientId?: string,
): EntraSettings {
  const tenant = tenantOf(tenantId)
  const api = apiClientIdOf(apiClientId)
  const scope = scopeOf(values.scope)
  const appIdUris = appIdUrisOf(values.appIdUri, api)
  const authority = authorityOf(values.authority)
  const clients = clientsOf(values.clientIds, webClientId)
  return { tenant, apiClientId: api, scope, appIdUris, authority, ...(clients && { clients }) }
}

/** The tenant's two issuers: its v2.0 authority's and its oauth21 one's. */
function issuersOf({ authority, tenant }: EntraSettings) {
  return { v2: `${authority}/${tenant}/v2.0`, oauth21: `${authority}/${tenant}/${OAUTH21}` }
}

/** Each issuer's key set, whose keys sign only for the issuer they are tagged with. */
function keySetsOf(settings: EntraSettings): JwtKeySet[] {
  const { v2, oauth21 } = issuersOf(settings)
  const v2Keys = `${settings.authority}/${settings.tenant}/discovery/v2.0/keys`
  return [
    { issuer: v2, jwks: new URL(v2Keys), taggedKeys: true },
    { issuer: oauth21, jwks: new URL(`${oauth21}/keys`), taggedKeys: true },
  ]
}

/** The App ID URI the API's scopes are named by: the first the operator names. */
const scopeUriOf = ({ appIdUris }: EntraSettings): string => appIdUris[0]

/** The required scope as a client asks for it and the gate reads it: `<App ID URI>/<scope>`. */
const fullScope = (settings: EntraSettings): string => `${scopeUriOf(settings)}/${settings.scope}`

/** A v1 token's `ver`, read before anything is verified, only to say how to get v2 tokens. */
function isVersionOne(token: string): boolean {
  try {
    return decodeJwt(token).ver === "1.0"
  } catch {
    return false
  }
}

const VERSION_ONE =
  "Token is an Entra ID v1 access token (ver 1.0, issuer https://sts.windows.net/<tenant>/): " +
  "set requestedAccessTokenVersion to 2 in the API registration's manifest"

/** Why Entra ID's rules refuse a token the shared verifier passed, or `undefined`. */
function claimsRefusal(claims: Claims, tenant: string): string | undefined {
  if (claims.ver !== "2.0") return "Token is no Entra ID v2.0 access token (its ver is not 2.0)"
  if (claims.tid !== undefined && claims.tid !== tenant) {
    return "Token was issued in another tenant (its tid)"
  }
  if (normalizedStrings(claims.scp).length === 0) {
    return "Token carries no scp: an app-only token or an ID token names no signed-in user"
  }
  return undefined
}

/** Entra ID's rules around the shared verifier: a v1 token before it, the claims after it. */
function entraVerifier(
  verifier: OAuthTokenVerifier,
  tenant: string,
  debug: boolean | undefined,
): OAuthTokenVerifier {
  const refused = (why: string) => {
    if (debug) console.error(`[oauth-debug] Entra ID refused the token: ${why}`)
    return invalidToken(why)
  }
  return {
    async verifyAccessToken(token) {
      if (isVersionOne(token)) throw refused(VERSION_ONE)
      const verified = await verifier.verifyAccessToken(token)
      const why = claimsRefusal(verified.extra?.payload as Claims, tenant)
      if (why !== undefined) throw refused(why)
      return verified
    },
  }
}

const subjectOf = mapSubject("Entra ID", CALLER_CLAIMS)

/** The caller by `oid`, else `sub`, and the app roles it was assigned as its permissions. */
function mapEntra(authInfo: AuthInfo) {
  const mapped = subjectOf(authInfo)
  return { ...mapped, permissions: normalizedStrings(mapped.payload.roles) }
}

/** Two values or more as one: `a or b`, `a, b or c`. */
const eitherOf = (values: readonly string[]): string =>
  `${values.slice(0, -1).join(", ")} or ${values.at(-1)}`

/** The boot line's words for what a token must carry besides its caller claim. */
function describeTokens(settings: EntraSettings, resource: URL): string {
  const { v2, oauth21 } = issuersOf(settings)
  const { apiClientId, appIdUris, clients } = settings
  const client = clients === undefined ? [] : [`a client id ${clients.join(" or ")}`]
  const named = appIdUris.map((uri) => (uri === resource.href ? `${uri} (RFC 8707)` : uri))
  return [
    `iss ${v2} or ${oauth21}`,
    `aud ${eitherOf([apiClientId, ...named])}`,
    "ver 2.0",
    `the scope ${fullScope(settings)}`,
    ...client,
  ].join(", ")
}

/** Microsoft Entra ID for one tenant over its settings. */
export function oauthEntraProvider(
  settings: EntraSettings,
  options: ProviderOptions = {},
): OAuthProvider {
  const { v2, oauth21 } = issuersOf(settings)
  const { apiClientId, appIdUris, clients, tenant } = settings
  const scope = fullScope(settings)
  return {
    oauthMetadata: { issuer: oauth21 },
    requiredScopes: [scope],
    callerClaims: CALLER_CLAIMS,
    describeAudience: (resource) => describeTokens(settings, resource),
    web: { scopes: WEB_SCOPES, discoveryIssuer: v2, resource: false, grantScopes: true },
    createTokenVerifier: (resource) =>
      entraVerifier(
        createJwtVerifier({
          keySets: keySetsOf(settings),
          resource,
          audiences: [apiClientId, ...appIdUris],
          resourceAudience: false,
          callerClaims: CALLER_CLAIMS,
          scopePrefix: scopeUriOf(settings),
          ...(clients && { clients }),
          debug: options.debug,
        }),
        tenant,
        options.debug,
      ),
    mapAuthInfo: mapEntra,
  }
}
