/**
 * A fake OpenID Connect provider on a loopback socket, for the web sign-in's tests: Keycloak's
 * paths and tokens by default, ADFS's with `flavor: "adfs"` (adfs.ts), an Entra ID tenant's with
 * `flavor: "entra"` (entra.ts). Started with `startFakeOidc()`, `env(origin)` names the variables
 * of the boot's own provider for it (Keycloak's `MCP_OAUTH_KEYCLOAK_SERVER_URL` and
 * `MCP_OAUTH_KEYCLOAK_REALM`, ADFS's generic `MCP_OAUTH_OIDC_ISSUER`, Entra ID's
 * `MCP_OAUTH_ENTRA_*`), which verifies its access
 * tokens with the real JWT verifier, and a client of `@miragon/pulse-http/oauth` discovers it,
 * signs in with PKCE as a confidential client, refreshes, revokes (Keycloak) and ends the session
 * against it. A browser sees its login page, a link per user; a test without one plays the browser
 * with `signIn` and `decline`. Node only, never bundled.
 */
import http from "node:http"
import type { AddressInfo } from "node:net"
import {
  authorize,
  CHOICE,
  discovery,
  endGrant,
  endpointOf,
  jwks,
  logout,
  revoke,
  token,
  type Answer,
  type FakeOidcEndpoint,
  type FakeOidcRequest,
} from "./endpoints.js"
import { ENTRA_SCOPE, entraEnv } from "./entra.js"
import {
  createRealm,
  ENTRA_TENANT,
  type EndedSession,
  type FakeOidcOptions,
  type IssuedTokens,
  type Realm,
} from "./realm.js"

/** An Entra ID tenant as the fake plays it: what a test's own provider of it needs. */
export interface FakeEntraTenant {
  /** The tenant's id, the first segment of its authorities' paths. */
  readonly tenant: string
  /**
   * `<serverUrl>/<tenant>/oauth21/2026-08`, the authority whose discovery names PKCE methods and
   * whose key set holds a key of its own; its v2.0 authority is the fake's `issuer`.
   */
  readonly oauth21Issuer: string
  /** The API registration's client id, the `aud` of its v2 access tokens. */
  readonly apiClientId: string
  /** The API's App ID URIs, which a `resource` must name exactly; the first prefixes its scopes. */
  readonly appIdUris: readonly string[]
  /** The scope the API exposes, as `scp` carries it: `user_impersonation`. */
  readonly scope: string
}

export interface FakeOidc {
  /** `http://127.0.0.1:<port>`: Keycloak's `MCP_OAUTH_KEYCLOAK_SERVER_URL`. */
  readonly serverUrl: string
  /** Keycloak's `MCP_OAUTH_KEYCLOAK_REALM`. */
  readonly realm: string
  /**
   * Its issuer, which its discovery and its ID tokens name: Keycloak's `<serverUrl>/realms/<realm>`,
   * ADFS's `<serverUrl>/adfs` (`MCP_OAUTH_OIDC_ISSUER`), Entra ID's v2.0 authority
   * `<serverUrl>/<tenant>/v2.0`.
   */
  readonly issuer: string
  /**
   * The `iss` of its access tokens: the issuer, ADFS's `<issuer>/services/trust`; Entra ID's of the
   * v2.0 authority (the oauth21 one's carry `entra.oauth21Issuer`).
   */
  readonly accessTokenIssuer: string
  /** Entra ID's tenant and API registration; undefined for the other flavors. */
  readonly entra?: FakeEntraTenant
  /**
   * The variables of a server at `origin` (its `MCP_URL`) whose OAuth provider is this one: the
   * flavor's `MCP_OAUTH_*` variables, ADFS's caller claim among them when it is no `sub`, Entra
   * ID's tenant, API client id, the fake's origin as the cloud's authority and an App ID URI that
   * is not the default.
   */
  env(origin: string): Record<string, string>
  /** Every request it received, in order. */
  readonly requests: readonly FakeOidcRequest[]
  /** Every token it minted, by kind. */
  readonly issued: IssuedTokens
  /** Every token a client revoked, in order. */
  readonly revoked: readonly string[]
  /** Every session ended at its end-session endpoint, in order. */
  readonly endedSessions: readonly EndedSession[]
  /**
   * The session (`sid`) a refresh token it issued belongs to, also once revoked or ended, so a
   * test can tell its own browser's renewals and revocations from those of tests beside it;
   * undefined for anything else.
   */
  sessionOf(refreshToken: string): string | undefined
  /**
   * Plays the browser at the authorization endpoint: signs in as `username` (default: the first
   * user) and resolves with the URL the provider sends the browser back to, the client's callback
   * with its code, or with its error when the request is refused. Rejects when the provider shows
   * a page instead (an unknown client, a redirect URI it may not use, an unknown user).
   */
  signIn(authorizationUrl: string, username?: string): Promise<string>
  /** Plays the browser that cancels at the login page: the callback with `access_denied`. */
  decline(authorizationUrl: string): Promise<string>
  /**
   * Refuses every refresh grant while `refuse` holds, as after the session ended at the provider
   * (Entra ID: an admin's "Revoke sessions").
   */
  refuseRefresh(refuse?: boolean): void
  /**
   * Ends the grant of the session `session` (its `sid`), as when the provider takes back a user's
   * access: its refresh tokens renew no more, at ADFS too.
   */
  endGrant(session: string): void
  close(): Promise<void>
}

/** A request body beyond this is no request a client of the provider sends. */
const MAX_BODY_BYTES = 64 * 1024

const ROUTES: readonly (readonly [FakeOidcEndpoint, readonly string[]])[] = [
  ["discovery", ["GET"]],
  ["jwks", ["GET"]],
  ["authorize", ["GET"]],
  ["token", ["POST"]],
  ["revoke", ["POST"]],
  ["logout", ["GET", "POST"]],
]

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) req.destroy(new Error("request body too large"))
      else chunks.push(chunk)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

async function requestOf(
  req: http.IncomingMessage,
  base: string,
  realm: Realm,
): Promise<FakeOidcRequest> {
  const url = new URL(req.url ?? "/", base)
  const endpoint = endpointOf(realm, url.pathname)
  const body = await readBody(req)
  const isForm = (req.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded")
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers[name] = value
  }
  return {
    endpoint,
    method: req.method ?? "GET",
    path: url.pathname,
    query: url.searchParams,
    form: new URLSearchParams(isForm ? body : ""),
    headers,
  }
}

const NOT_FOUND: Answer = {
  status: 404,
  headers: { "content-type": "application/json" },
  body: '{"error":"not_found"}',
}

async function answerOf(realm: Realm, request: FakeOidcRequest): Promise<Answer> {
  const route = ROUTES.find(([name]) => name === request.endpoint)
  if (route === undefined) return NOT_FOUND
  if (!route[1].includes(request.method)) {
    return { status: 405, headers: { allow: route[1].join(", ") } }
  }
  switch (route[0]) {
    case "discovery":
      return discovery(realm, request.path)
    case "jwks":
      return jwks(realm, request.path)
    case "authorize":
      return authorize(realm, request.query, request.path)
    case "token":
      return token(realm, request)
    case "revoke":
      return revoke(realm, request)
    case "logout":
      return logout(realm, request)
  }
}

function write(res: http.ServerResponse, answer: Answer): void {
  for (const [name, value] of Object.entries(answer.headers ?? {})) res.setHeader(name, value)
  res.statusCode = answer.status
  res.end(answer.body ?? "")
}

/** Follows the authorization request with the browser's choice; resolves with where it goes. */
async function choose(authorizationUrl: string, name: string, value: string): Promise<string> {
  const url = new URL(authorizationUrl)
  url.searchParams.set(name, value)
  const response = await fetch(url, { redirect: "manual" })
  const location = response.headers.get("location")
  if (response.status !== 302 || location === null) {
    throw new Error(
      `The fake identity provider showed a page instead of returning (${response.status}): ${await response.text()}`,
    )
  }
  return location
}

/** The variables of the boot's provider for `realm`, at a server on `origin`. */
function envOf(
  realm: Realm,
  serverUrl: string,
  name: string,
  origin: string,
): Record<string, string> {
  if (realm.flavor === "keycloak") {
    return {
      MCP_URL: origin,
      MCP_OAUTH_KEYCLOAK_SERVER_URL: serverUrl,
      MCP_OAUTH_KEYCLOAK_REALM: name,
    }
  }
  if (realm.flavor === "entra") return { MCP_URL: origin, ...entraEnv(realm, serverUrl) }
  const claim = realm.callerClaim
  return {
    MCP_URL: origin,
    MCP_OAUTH_OIDC_ISSUER: realm.issuer,
    ...(claim === undefined || claim === "sub" ? {} : { MCP_OAUTH_OIDC_SUBJECT_CLAIM: claim }),
  }
}

/** The issuer of the flavor at `serverUrl`: Keycloak's realm, ADFS's `/adfs`, Entra's v2.0 authority. */
function issuerOf(serverUrl: string, realm: string, options: FakeOidcOptions): string {
  switch (options.flavor) {
    case "adfs":
      return `${serverUrl}/adfs`
    case "entra":
      return `${serverUrl}/${options.tenant ?? ENTRA_TENANT}/v2.0`
    default:
      return `${serverUrl}/realms/${encodeURIComponent(realm)}`
  }
}

/** What a test reads of the realm's Entra ID tenant, as the provider's `entra`; none elsewhere. */
function entraOf(realm: Realm): { entra?: FakeEntraTenant } {
  const { entra } = realm
  if (entra === undefined) return {}
  const { tenant, oauth21Issuer, apiClientId, appIdUris } = entra
  return { entra: { tenant, oauth21Issuer, apiClientId, appIdUris, scope: ENTRA_SCOPE } }
}

/** Starts the provider on an ephemeral loopback port. */
export async function startFakeOidc(options: FakeOidcOptions = {}): Promise<FakeOidc> {
  const realmName = options.realm ?? "pulse"
  const server = http.createServer()
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const realm = await createRealm(issuerOf(serverUrl, realmName, options), options)
  const { issuer } = realm
  const requests: FakeOidcRequest[] = []
  server.on("request", (req, res) => {
    requestOf(req, serverUrl, realm)
      .then((request) => {
        requests.push(request)
        return answerOf(realm, request)
      })
      .then((answer) => write(res, answer))
      .catch((error: unknown) => write(res, { status: 500, body: String(error) }))
  })
  const firstUser = realm.users[0]?.username ?? ""
  return {
    serverUrl,
    realm: realmName,
    issuer,
    accessTokenIssuer: realm.accessTokenIssuer,
    ...entraOf(realm),
    env: (origin) => envOf(realm, serverUrl, realmName, origin),
    requests,
    issued: realm.issued,
    revoked: realm.revoked,
    endedSessions: realm.endedSessions,
    sessionOf: (refreshToken) => realm.grants.get(refreshToken)?.sid,
    signIn: (authorizationUrl, username = firstUser) =>
      choose(authorizationUrl, CHOICE.user, username),
    decline: (authorizationUrl) => choose(authorizationUrl, CHOICE.decline, "1"),
    refuseRefresh: (refuse = true) => {
      realm.refusingRefresh = refuse
    },
    endGrant: (session) => endGrant(realm, session),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
