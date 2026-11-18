/**
 * The fake identity provider's endpoints under its issuer, on Keycloak's paths or ADFS's
 * (adfs.ts): discovery, the key set, the authorization endpoint with a login page that offers each
 * user, the token endpoint (the code grant with PKCE, the refresh grant, the client's
 * authentication), revocation (Keycloak's alone) and the end of a session. Each answers a parsed
 * request with a plain answer, as the provider it plays would.
 */
import { randomUUID } from "node:crypto"
import { decodeJwt } from "jose"
import { ADFS_PATHS, adfsDiscovery, issueAdfsTokens } from "./adfs.js"
import {
  issueTokens,
  opaqueToken,
  s256,
  type FakeOidcClient,
  type FakeOidcUser,
  type Grant,
  type IssuedSession,
  type Realm,
} from "./realm.js"

export type FakeOidcEndpoint = "discovery" | "jwks" | "authorize" | "token" | "revoke" | "logout"

/** A request the provider received, kept for a test's assertions. */
export interface FakeOidcRequest {
  readonly endpoint: FakeOidcEndpoint | "unknown"
  readonly method: string
  readonly path: string
  readonly query: URLSearchParams
  /** The form body (`application/x-www-form-urlencoded`), else empty. */
  readonly form: URLSearchParams
  /** Header names in lower case. */
  readonly headers: Readonly<Record<string, string>>
}

export interface Answer {
  readonly status: number
  readonly headers?: Readonly<Record<string, string | readonly string[]>>
  readonly body?: string
}

/** The paths below the issuer, Keycloak's. */
const KEYCLOAK_PATHS: Readonly<Record<FakeOidcEndpoint, string>> = {
  discovery: "/.well-known/openid-configuration",
  jwks: "/protocol/openid-connect/certs",
  authorize: "/protocol/openid-connect/auth",
  token: "/protocol/openid-connect/token",
  revoke: "/protocol/openid-connect/revoke",
  logout: "/protocol/openid-connect/logout",
}

const isAdfs = (realm: Realm): boolean => realm.flavor === "adfs"

/** The paths below the realm's issuer: Keycloak's, or ADFS's, which has no revocation endpoint. */
export const pathsOf = (realm: Realm): Readonly<Partial<Record<FakeOidcEndpoint, string>>> =>
  isAdfs(realm) ? ADFS_PATHS : KEYCLOAK_PATHS

/** The query parameters of the login page's choices, which no real provider reads. */
export const CHOICE = { user: "fake_user", decline: "fake_decline" } as const

/** The provider's own session cookie, by which the end-session endpoint knows the browser. */
const SESSION_COOKIE = "KEYCLOAK_SESSION"
const CODE_LIFETIME_MS = 60_000
const NO_STORE = { "cache-control": "no-store" }

const json = (status: number, value: unknown): Answer => ({
  status,
  headers: { "content-type": "application/json", ...NO_STORE },
  body: JSON.stringify(value),
})

const oauthError = (status: number, error: string, description: string): Answer =>
  json(status, { error, error_description: description })

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

const page = (status: number, title: string, body = ""): Answer => ({
  status,
  headers: { "content-type": "text/html; charset=utf-8", ...NO_STORE },
  body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`,
})

function withQuery(uri: string, params: Readonly<Record<string, string | null | undefined>>) {
  const url = new URL(uri)
  for (const [name, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) url.searchParams.append(name, value)
  }
  return url.href
}

const isAllowed = (allowed: readonly string[] | undefined, uri: string): boolean =>
  URL.canParse(uri) && (allowed === undefined || allowed.includes(uri))

const endpointUrl = (realm: Realm, endpoint: FakeOidcEndpoint): string =>
  `${realm.issuer}${KEYCLOAK_PATHS[endpoint]}`

export function discovery(realm: Realm): Answer {
  if (isAdfs(realm)) return json(200, adfsDiscovery(realm))
  return json(200, {
    issuer: realm.issuer,
    authorization_endpoint: endpointUrl(realm, "authorize"),
    token_endpoint: endpointUrl(realm, "token"),
    jwks_uri: endpointUrl(realm, "jwks"),
    revocation_endpoint: endpointUrl(realm, "revoke"),
    end_session_endpoint: endpointUrl(realm, "logout"),
    grant_types_supported: ["authorization_code", "refresh_token"],
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "profile", "email", "offline_access"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
    revocation_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
    code_challenge_methods_supported: ["plain", "S256"],
    authorization_response_iss_parameter_supported: true,
  })
}

export const jwks = (realm: Realm): Answer => json(200, { keys: [realm.jwk] })

/** The login page: a link per user and one that declines, each the request with its choice. */
function loginPage(realm: Realm, query: URLSearchParams, notice = ""): Answer {
  const choice = (name: string, value: string) => {
    const next = new URLSearchParams(query)
    next.delete(CHOICE.user)
    next.set(name, value)
    return escapeHtml(`?${next.toString()}`)
  }
  const users = realm.users
    .map(
      (user) =>
        `<li><a href="${choice(CHOICE.user, user.username)}">${escapeHtml(user.username)}</a></li>`,
    )
    .join("")
  const declined = `<p><a href="${choice(CHOICE.decline, "1")}">Cancel</a></p>`
  const note = notice === "" ? "" : `<p role="alert">${escapeHtml(notice)}</p>`
  return page(200, "Sign in", `${note}<ul>${users}</ul>${declined}`)
}

/**
 * The authorization endpoint (RFC 6749 §4.1.1): a request it cannot send back is a page of its
 * own, any other refusal goes back to the client; else the login page, or the code for the user
 * the page's link chose, with the provider's session cookie.
 */
export function authorize(realm: Realm, query: URLSearchParams): Answer {
  const client = realm.clients.get(query.get("client_id") ?? "")
  if (client === undefined) return page(400, "Client not found.")
  const redirectUri = query.get("redirect_uri") ?? ""
  if (!isAllowed(client.redirectUris, redirectUri)) {
    return page(400, "Invalid parameter: redirect_uri")
  }
  // ADFS sends no iss (RFC 9207) back.
  const iss = isAdfs(realm) ? null : realm.issuer
  const back = (params: Record<string, string>, headers?: Record<string, string>): Answer => ({
    status: 302,
    headers: {
      location: withQuery(redirectUri, { ...params, state: query.get("state"), iss }),
      ...headers,
    },
  })
  const refused = requestRefusal(realm, query)
  if (refused !== undefined) return back(refused)
  const username = query.get(CHOICE.user)
  if (username === null) return loginPage(realm, query)
  const user = realm.users.find((candidate) => candidate.username === username)
  if (user === undefined) return loginPage(realm, query, "Invalid username or password.")
  const { code, sid } = newCode(realm, { clientId: client.id, redirectUri, query, user })
  const cookie = `${SESSION_COOKIE}=${sid}; Path=${new URL(realm.issuer).pathname}/; HttpOnly; SameSite=Lax`
  return back({ session_state: sid, code }, { "set-cookie": cookie })
}

/**
 * Why the authorization request goes back refused, or `undefined`: its response type, ADFS's one
 * resource, PKCE S256, or the browser that cancelled.
 */
function requestRefusal(realm: Realm, query: URLSearchParams): Record<string, string> | undefined {
  if (query.get("response_type") !== "code") return { error: "unsupported_response_type" }
  if (isAdfs(realm) && query.getAll("resource").length > 1) {
    return { error: "invalid_request", error_description: "MSIS9xxx: one resource only." }
  }
  if (query.get("code_challenge_method") !== "S256" || !query.get("code_challenge")) {
    return {
      error: "invalid_request",
      error_description: "Missing parameter: code_challenge_method",
    }
  }
  return query.has(CHOICE.decline) ? { error: "access_denied" } : undefined
}

/** A code for the user the login page chose, good once for a minute, in a new session. */
function newCode(
  realm: Realm,
  request: {
    clientId: string
    redirectUri: string
    query: URLSearchParams
    user: FakeOidcUser
  },
): { code: string; sid: string } {
  const { clientId, redirectUri, query, user } = request
  const code = opaqueToken()
  const sid = randomUUID()
  const nonce = query.get("nonce")
  const resource = query.get("resource")
  realm.codes.set(code, {
    clientId,
    redirectUri,
    challenge: query.get("code_challenge") ?? "",
    scope: query.get("scope") ?? "openid",
    ...(nonce === null ? {} : { nonce }),
    ...(resource === null ? {} : { resource }),
    user,
    sid,
    expiresAt: Date.now() + CODE_LIFETIME_MS,
  })
  return { code, sid }
}

/** `user:password` of a Basic header, each part form-decoded as RFC 6749 §2.3.1 encodes it. */
function basicCredentials(header: string): [string, string] {
  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8")
  const at = decoded.indexOf(":")
  const formDecode = (part: string) => new URLSearchParams(`v=${part}`).get("v") ?? ""
  return at < 0
    ? [formDecode(decoded), ""]
    : [formDecode(decoded.slice(0, at)), formDecode(decoded.slice(at + 1))]
}

const CLIENT_REFUSED = "Invalid client or Invalid client credentials"

/** The client a token or revocation request authenticates as, by its Basic header or its form. */
function clientOf(realm: Realm, request: FakeOidcRequest): FakeOidcClient | Answer {
  const header = request.headers.authorization
  const [id, secret] = header?.startsWith("Basic ")
    ? basicCredentials(header)
    : [request.form.get("client_id") ?? "", request.form.get("client_secret") ?? undefined]
  const client = realm.clients.get(id)
  if (client === undefined) return oauthError(401, "invalid_client", CLIENT_REFUSED)
  if (client.secret !== undefined && client.secret !== secret) {
    return oauthError(401, "unauthorized_client", CLIENT_REFUSED)
  }
  return client
}

const isAnswer = (value: FakeOidcClient | Answer): value is Answer => "status" in value

/**
 * A grant's tokens as the realm's provider answers them: ADFS's for the resource the request
 * names (else `fallback`, the code's), a refresh token at the sign-in alone; Keycloak's whatever
 * the request names.
 */
function tokensOf(
  realm: Realm,
  session: IssuedSession,
  form: URLSearchParams,
  { renewal, fallback }: { renewal: boolean; fallback?: string },
): Promise<Record<string, unknown>> {
  if (!isAdfs(realm)) return issueTokens(realm, session)
  return issueAdfsTokens(realm, session, form.get("resource") ?? fallback, renewal)
}

async function codeGrant(realm: Realm, client: FakeOidcClient, form: URLSearchParams) {
  const presented = form.get("code") ?? ""
  const code = realm.codes.get(presented)
  realm.codes.delete(presented)
  if (code === undefined || code.expiresAt <= Date.now() || code.clientId !== client.id) {
    return oauthError(400, "invalid_grant", "Code not valid")
  }
  if (form.get("redirect_uri") !== code.redirectUri) {
    return oauthError(400, "invalid_grant", "Incorrect redirect_uri")
  }
  const verifier = form.get("code_verifier")
  if (!verifier) return oauthError(400, "invalid_grant", "PKCE code verifier not specified")
  if (s256(verifier) !== code.challenge) {
    return oauthError(400, "invalid_grant", "PKCE verification failed: Code mismatch")
  }
  return json(200, await tokensOf(realm, code, form, { renewal: false, fallback: code.resource }))
}

const isLive = (realm: Realm, grant: Grant | undefined): grant is Grant =>
  grant !== undefined && grant.active && grant.expiresAt > Date.now() && !realm.refusingRefresh

/** Auth0's reuse detection: a spent refresh token used again revokes every one of its sign-in. */
function revokeOnReuse(realm: Realm, grant: Grant | undefined): void {
  if (!realm.revokeFamilyOnReuse || grant?.spent !== true) return
  for (const other of realm.grants.values()) if (other.sid === grant.sid) other.active = false
}

async function refreshGrant(realm: Realm, client: FakeOidcClient, form: URLSearchParams) {
  const grant = realm.grants.get(form.get("refresh_token") ?? "")
  revokeOnReuse(realm, grant)
  if (!isLive(realm, grant)) return oauthError(400, "invalid_grant", "Token is not active")
  if (grant.clientId !== client.id) {
    return oauthError(400, "invalid_grant", "Token client and authorized client don't match")
  }
  if (realm.rotateRefreshTokens) {
    grant.active = false
    grant.spent = true
  }
  return json(200, await tokensOf(realm, grant, form, { renewal: true }))
}

/** The token endpoint (RFC 6749 §3.2): the client authenticated, then its grant. */
export async function token(realm: Realm, request: FakeOidcRequest): Promise<Answer> {
  const client = clientOf(realm, request)
  if (isAnswer(client)) return client
  switch (request.form.get("grant_type")) {
    case "authorization_code":
      return codeGrant(realm, client, request.form)
    case "refresh_token":
      return refreshGrant(realm, client, request.form)
    default:
      return oauthError(400, "unsupported_grant_type", "Unsupported grant_type")
  }
}

/** The revocation endpoint (RFC 7009): a refresh token of the client renews no more. */
export function revoke(realm: Realm, request: FakeOidcRequest): Answer {
  const client = clientOf(realm, request)
  if (isAnswer(client)) return client
  const presented = request.form.get("token") ?? ""
  const grant = realm.grants.get(presented)
  if (grant?.clientId === client.id) grant.active = false
  realm.revoked.push(presented)
  return { status: 200, headers: NO_STORE }
}

/** Every refresh token of the session `sid` renews no more. */
export function endGrant(realm: Realm, sid: string | undefined): void {
  for (const grant of realm.grants.values()) if (grant.sid === sid) grant.active = false
}

function sessionOf(request: FakeOidcRequest, hint: string | null): string | undefined {
  const cookie = (request.headers.cookie ?? "")
    .split(";")
    .map((pair) => pair.trim().split("="))
    .find(([name]) => name === SESSION_COOKIE)?.[1]
  if (cookie !== undefined) return cookie
  try {
    const sid = hint === null ? undefined : decodeJwt(hint).sid
    return typeof sid === "string" ? sid : undefined
  } catch {
    return undefined
  }
}

/**
 * The end-session endpoint (OpenID Connect RP-Initiated Logout 1.0): the browser's session ends
 * (every refresh token of it at Keycloak; ADFS's renew on, as its FAQ says), and the browser
 * returns where the client asked, when the client may return there. Unlike Keycloak it asks no
 * confirmation without an ID token hint.
 */
export function logout(realm: Realm, request: FakeOidcRequest): Answer {
  const params = request.method === "POST" ? request.form : request.query
  const clientId = params.get("client_id") ?? undefined
  const postLogoutRedirectUri = params.get("post_logout_redirect_uri") ?? undefined
  const sid = sessionOf(request, params.get("id_token_hint"))
  if (!isAdfs(realm)) endGrant(realm, sid)
  realm.endedSessions.push({ clientId, postLogoutRedirectUri, sid })
  const cleared = `${SESSION_COOKIE}=; Path=${new URL(realm.issuer).pathname}/; Max-Age=0; HttpOnly; SameSite=Lax`
  if (postLogoutRedirectUri === undefined) {
    const signedOut = page(200, "You are signed out.")
    return { ...signedOut, headers: { ...signedOut.headers, "set-cookie": cleared } }
  }
  const client = realm.clients.get(clientId ?? "")
  if (client === undefined || !isAllowed(client.postLogoutRedirectUris, postLogoutRedirectUri)) {
    return page(400, "Invalid redirect uri")
  }
  const location = withQuery(postLogoutRedirectUri, { state: params.get("state") })
  return { status: 302, headers: { location, "set-cookie": cleared } }
}
