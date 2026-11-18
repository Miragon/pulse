/**
 * The fake identity provider as Microsoft Entra ID plays one tenant (`flavor: "entra"`), from
 * Microsoft's documentation and the tenants' live discovery documents and key sets: two
 * authorities under the tenant's id, the GA v2.0 one (the realm's issuer, its discovery without
 * PKCE methods, a revocation endpoint or the `iss` of the authorization response, with an
 * end-session endpoint) and `oauth21/2026-08` (with PKCE methods and the `iss`, also at the RFC
 * 8414 path), each with a key set whose keys name it as their issuer, the oauth21 one holding a key
 * the v2.0 one lacks, which signs that authority's tokens. Its v2 access tokens carry the issuer of
 * the authority asked, the API registration's client id as `aud` where the scopes name the API
 * (Microsoft Graph's otherwise), the API's scopes short in `scp`, `ver`, `azp`, a `sub` hashed per
 * client, `name` and `preferred_username`, and `oid` and `tid` only where `profile` was asked; with
 * `tokenVersion: 1` they are v1 tokens of `https://sts.windows.net/<tenant>/`. A `resource` that is
 * no App ID URI of the API is refused (AADSTS9010010), and so is a code exchange without a scope
 * (AADSTS28003). A refresh token comes only with `offline_access`, every grant gives a new one and
 * the old one renews on; the end of a session leaves them alive (single sign-out), as Entra's do,
 * while `refuseRefresh` plays an admin's "Revoke sessions". An access token comes to about 2.5 KB,
 * as a real one, and with `groups` it carries 200 group ids.
 */
import { createHash, randomBytes } from "node:crypto"
import type { FakeOidcEndpoint } from "./endpoints.js"
import {
  newRefreshToken,
  sign,
  type EntraTenant,
  type FakeOidcUser,
  type IssuedSession,
  type Realm,
} from "./realm.js"

/** One of the tenant's two authorities. */
export type EntraAuthority = "v2.0" | "oauth21"

/** An endpoint of the tenant and the authority it belongs to. */
export interface EntraRoute {
  readonly endpoint: FakeOidcEndpoint
  readonly authority: EntraAuthority
}

const OAUTH21 = "oauth21/2026-08"

/** Microsoft Graph's application id: the audience of a token whose scopes name no API. */
export const GRAPH = "00000003-0000-0000-c000-000000000000"

/** The scope the API exposes, as `scp` carries it. */
export const ENTRA_SCOPE = "user_impersonation"

const tenantOf = (realm: Realm): EntraTenant => {
  if (realm.entra === undefined) throw new TypeError("The realm plays no Entra ID tenant")
  return realm.entra
}

/** The paths of the tenant's endpoints, each with its endpoint and authority. */
function routesOf(realm: Realm): readonly (readonly [string, EntraRoute])[] {
  const tenant = `/${tenantOf(realm).tenant}`
  const v2 = (endpoint: FakeOidcEndpoint): EntraRoute => ({ endpoint, authority: "v2.0" })
  const o21 = (endpoint: FakeOidcEndpoint): EntraRoute => ({ endpoint, authority: "oauth21" })
  return [
    [`${tenant}/v2.0/.well-known/openid-configuration`, v2("discovery")],
    [`${tenant}/discovery/v2.0/keys`, v2("jwks")],
    [`${tenant}/oauth2/v2.0/authorize`, v2("authorize")],
    [`${tenant}/oauth2/v2.0/token`, v2("token")],
    [`${tenant}/oauth2/v2.0/logout`, v2("logout")],
    [`${tenant}/${OAUTH21}/.well-known/openid-configuration`, o21("discovery")],
    [`/.well-known/oauth-authorization-server${tenant}/${OAUTH21}`, o21("discovery")],
    [`${tenant}/${OAUTH21}/keys`, o21("jwks")],
    [`${tenant}/${OAUTH21}/authorize`, o21("authorize")],
    [`${tenant}/${OAUTH21}/token`, o21("token")],
    [`${tenant}/${OAUTH21}/logout`, o21("logout")],
  ]
}

/** The tenant's endpoint at `pathname`, or none. */
export function entraRouteOf(realm: Realm, pathname: string): EntraRoute | undefined {
  return routesOf(realm).find(([path]) => path === pathname)?.[1]
}

/** The authority of a request to the tenant, the v2.0 one for a path of neither. */
export const authorityOf = (realm: Realm, pathname: string): EntraAuthority =>
  entraRouteOf(realm, pathname)?.authority ?? "v2.0"

/** The issuer of an authority. */
const entraIssuer = (realm: Realm, authority: EntraAuthority): string =>
  authority === "oauth21" ? tenantOf(realm).oauth21Issuer : realm.issuer

/** The authority's endpoint URL. */
function urlOf(realm: Realm, authority: EntraAuthority, endpoint: FakeOidcEndpoint): string {
  const found = routesOf(realm).find(
    ([path, route]) =>
      route.authority === authority && route.endpoint === endpoint && !path.startsWith("/."),
  )
  return `${new URL(realm.issuer).origin}${String(found?.[0])}`
}

const CLAIMS_SUPPORTED = [
  "sub",
  "iss",
  "aud",
  "exp",
  "iat",
  "auth_time",
  "acr",
  "nonce",
  "preferred_username",
  "name",
  "tid",
  "ver",
  "at_hash",
  "c_hash",
  "email",
]

/** What only the oauth21 authority's discovery names: PKCE methods, the `iss`, its grants. */
const OAUTH21_ONLY = {
  code_challenge_methods_supported: ["plain", "S256"],
  authorization_response_iss_parameter_supported: true,
  grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
  client_id_metadata_document_supported: true,
}

/** The authority's discovery document, as the tenant's live one has it (no revocation endpoint). */
export function entraDiscovery(realm: Realm, authority: EntraAuthority): Record<string, unknown> {
  const url = (endpoint: FakeOidcEndpoint) => urlOf(realm, authority, endpoint)
  return {
    issuer: entraIssuer(realm, authority),
    authorization_endpoint: url("authorize"),
    token_endpoint: url("token"),
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      "private_key_jwt",
      "client_secret_basic",
      "self_signed_tls_client_auth",
    ],
    jwks_uri: url("jwks"),
    response_modes_supported: ["query", "fragment", "form_post"],
    subject_types_supported: ["pairwise"],
    id_token_signing_alg_values_supported: ["RS256"],
    response_types_supported: ["code", "id_token", "code id_token", "id_token token"],
    scopes_supported: ["openid", "profile", "email", "offline_access"],
    request_uri_parameter_supported: false,
    userinfo_endpoint: "https://graph.microsoft.com/oidc/userinfo",
    end_session_endpoint: url("logout"),
    frontchannel_logout_supported: true,
    http_logout_supported: true,
    claims_supported: CLAIMS_SUPPORTED,
    tenant_region_scope: "WW",
    cloud_instance_name: "microsoftonline.com",
    ...(authority === "oauth21" ? OAUTH21_ONLY : {}),
  }
}

/**
 * The authority's key set: each key names it as its issuer; oauth21's holds its own key besides.
 */
export function entraKeys(realm: Realm, authority: EntraAuthority): Record<string, unknown> {
  const issuer = entraIssuer(realm, authority)
  const own = authority === "oauth21" ? [tenantOf(realm).oauth21Key.jwk] : []
  const keys = [realm.jwk, ...own].map((jwk) => ({
    ...jwk,
    cloud_instance_name: "microsoftonline.com",
    issuer,
  }))
  return { keys }
}

/** The `iss` of the authorization response: the oauth21 authority's alone. */
export const entraResponseIss = (realm: Realm, pathname: string): string | null =>
  authorityOf(realm, pathname) === "oauth21" ? tenantOf(realm).oauth21Issuer : null

const RESOURCE_REFUSED = {
  error: "invalid_target",
  error_description:
    "AADSTS9010010: The resource parameter provided in the request doesn't match with the requested scopes.",
}

const SCOPE_MISSING = {
  error: "invalid_request",
  error_description:
    "AADSTS28003: Provided value for the input parameter scope cannot be empty when requesting an access token using the provided authorization code. Please specify a valid scope.",
}

/** Why the tenant refuses a request's `resource`: one that is no App ID URI of the API. */
export function entraResourceRefusal(
  realm: Realm,
  params: URLSearchParams,
): Record<string, string> | undefined {
  const { appIdUris } = tenantOf(realm)
  const named = params.getAll("resource")
  return named.every((resource) => appIdUris.includes(resource)) ? undefined : RESOURCE_REFUSED
}

/**
 * Why the token endpoint refuses a grant before it looks at it: its resource, a code exchange
 * without a scope.
 */
export function entraGrantRefusal(
  realm: Realm,
  form: URLSearchParams,
): Record<string, string> | undefined {
  const refused = entraResourceRefusal(realm, form)
  if (refused !== undefined) return refused
  const code = form.get("grant_type") === "authorization_code"
  return code && (form.get("scope") ?? "").trim() === "" ? SCOPE_MISSING : undefined
}

/** The API's scopes a request names, short as `scp` carries them (`.default` its one scope). */
function apiScopesOf(tenant: EntraTenant, scopes: readonly string[]): string[] {
  const short = scopes.flatMap((scope) => {
    const uri = tenant.appIdUris.find((candidate) => scope.startsWith(`${candidate}/`))
    if (uri === undefined) return []
    const value = scope.slice(uri.length + 1)
    return [value === ".default" ? ENTRA_SCOPE : value]
  })
  return [...new Set(short)]
}

/** A `sub` as Entra hashes it per application: here per client, the stricter reading. */
const pairwise = (clientId: string, user: FakeOidcUser): string =>
  createHash("sha256").update(`${clientId}:${user.sub}`).digest("base64url")

const opaque = (bytes: number): string => randomBytes(bytes).toString("base64url")

/** A group's id, a GUID of its number. */
function groupId(index: number): string {
  const hex = createHash("sha256").update(`group-${index}`).digest("hex")
  return hex.slice(0, 32).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5")
}

/** 200 group ids, as many as a token carries before Entra names an overage instead. */
const groups = (): string[] => Array.from({ length: 200 }, (_, index) => groupId(index))

const seconds = (ms: number): number => Math.floor(ms / 1000)

/**
 * The claims every Entra token carries beside its own: `aio` (opaque, sized so an access token
 * comes to about 2.5 KB), `rh`, `uti` and `nbf`.
 */
const opaqueClaims = () => ({
  nbf: seconds(Date.now()),
  aio: opaque(700),
  rh: `1.${opaque(48)}.`,
  uti: opaque(16),
})

const nameClaims = (user: FakeOidcUser) => ({
  ...(user.name === undefined ? {} : { name: user.name }),
  preferred_username: user.email ?? user.username,
})

/** `oid` and `tid`, which Entra issues only where `profile` was asked. */
const profileIds = (tenant: EntraTenant, user: FakeOidcUser, scopes: readonly string[]) =>
  scopes.includes("profile") ? { oid: user.sub, tid: tenant.tenant } : {}

interface Grant {
  readonly realm: Realm
  readonly tenant: EntraTenant
  readonly session: IssuedSession
  readonly scopes: readonly string[]
  readonly authority: EntraAuthority
  readonly resource: string | null
}

/** A v2 access token of the authority asked, for the API where the scopes name it. */
function v2AccessToken(grant: Grant): Promise<string> {
  const { realm, tenant, session, scopes, authority } = grant
  const { clientId, user, sid } = session
  const api = apiScopesOf(tenant, scopes)
  const claims = {
    aud: api.length === 0 ? GRAPH : tenant.apiClientId,
    ...opaqueClaims(),
    azp: clientId,
    azpacr: "1",
    ...nameClaims(user),
    ...profileIds(tenant, user, scopes),
    scp: api.length === 0 ? scopes.join(" ") : api.join(" "),
    sid,
    sub: pairwise(clientId, user),
    ver: "2.0",
    ...(tenant.groups ? { groups: groups() } : {}),
  }
  const issuer = entraIssuer(realm, authority)
  const key = authority === "oauth21" ? tenant.oauth21Key : realm
  return sign(realm, claims, realm.accessTokenSeconds, issuer, key)
}

/** A v1 access token, as an API on `requestedAccessTokenVersion` 1 gets it. */
function v1AccessToken(grant: Grant): Promise<string> {
  const { realm, tenant, session, scopes, resource } = grant
  const { clientId, user } = session
  const claims = {
    aud: resource ?? tenant.appIdUris[0],
    ...opaqueClaims(),
    appid: clientId,
    appidacr: "1",
    ...nameClaims(user),
    oid: user.sub,
    tid: tenant.tenant,
    scp: apiScopesOf(tenant, scopes).join(" "),
    sub: pairwise(clientId, user),
    ...(user.email === undefined ? {} : { upn: user.email, unique_name: user.email }),
    ver: "1.0",
  }
  const issuer = `https://sts.windows.net/${tenant.tenant}/`
  return sign(realm, claims, realm.accessTokenSeconds, issuer)
}

/** A v2 ID token of the authority asked, for the client. */
function idToken(grant: Grant): Promise<string> {
  const { realm, tenant, session, scopes, authority } = grant
  const { clientId, user, sid, nonce } = session
  const claims = {
    aud: clientId,
    ...opaqueClaims(),
    ...(scopes.includes("profile") ? { ...nameClaims(user), oid: user.sub } : {}),
    ...(nonce ? { nonce } : {}),
    sid,
    sub: pairwise(clientId, user),
    tid: tenant.tenant,
    ver: "2.0",
  }
  const issuer = entraIssuer(realm, authority)
  const key = authority === "oauth21" ? tenant.oauth21Key : realm
  return sign(realm, claims, realm.accessTokenSeconds, issuer, key)
}

/**
 * A sign-in's or a refresh's tokens, as Entra's token endpoint at `pathname` answers them: for the
 * scope the request names (a refresh without one keeps its grant's), a new refresh token where
 * `offline_access` is among them, an ID token where `openid` is.
 */
export async function issueEntraTokens(
  realm: Realm,
  session: IssuedSession,
  form: URLSearchParams,
  pathname: string,
): Promise<Record<string, unknown>> {
  const scope = form.get("scope") ?? session.scope
  const scopes = scope.split(" ").filter(Boolean)
  const tenant = tenantOf(realm)
  const authority = authorityOf(realm, pathname)
  const grant: Grant = { realm, tenant, session, scopes, authority, resource: form.get("resource") }
  const accessToken = await (tenant.tokenVersion === 1
    ? v1AccessToken(grant)
    : v2AccessToken(grant))
  realm.issued.access.push(accessToken)
  const renewable = realm.refreshTokens && scopes.includes("offline_access")
  const refreshToken = renewable ? newRefreshToken(realm, { ...session, scope }) : undefined
  const id = scopes.includes("openid") ? await idToken(grant) : undefined
  if (id !== undefined) realm.issued.id.push(id)
  return {
    token_type: "Bearer",
    scope,
    expires_in: realm.accessTokenSeconds,
    ext_expires_in: realm.accessTokenSeconds,
    access_token: accessToken,
    ...(refreshToken === undefined ? {} : { refresh_token: refreshToken }),
    ...(id === undefined ? {} : { id_token: id }),
  }
}
