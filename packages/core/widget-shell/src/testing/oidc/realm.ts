/**
 * The fake identity provider's realm: its settings, its users and clients, the codes and sessions
 * a sign-in leaves, and the tokens it mints, signed with its own RS256 key as Keycloak signs them
 * (ADFS's tokens: adfs.ts; Entra ID's, with a second key of its oauth21 authority: entra.ts).
 */
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose"

export interface FakeOidcUser {
  /** The `sub` of the user's tokens, the caller id the server reads. */
  readonly sub: string
  /** The name the login page offers and `preferred_username` carries. */
  readonly username: string
  readonly name?: string
  readonly email?: string
}

export interface FakeOidcClient {
  readonly id: string
  /** A confidential client's secret, sent by client_secret_basic or client_secret_post. */
  readonly secret?: string
  /** Where a sign-in may return to, exactly; unset, any URI (Keycloak's `*`). */
  readonly redirectUris?: readonly string[]
  /** Where an ended session may return to, exactly; unset, any URI. */
  readonly postLogoutRedirectUris?: readonly string[]
}

/**
 * Whose provider the fake plays: Keycloak's paths and tokens, ADFS's (adfs.ts) or Entra ID's
 * (entra.ts).
 */
export type FakeOidcFlavor = "keycloak" | "adfs" | "entra"

export interface FakeOidcOptions {
  /**
   * Keycloak (the default) or ADFS 2019 and later: its issuer `<serverUrl>/adfs`, its paths and
   * discovery, access tokens of the issuer its discovery names as `access_token_issuer` for the
   * request's resource, refresh tokens that never rotate and outlive the end of a session.
   */
  readonly flavor?: FakeOidcFlavor
  /**
   * ADFS: the claim the Web API's issuance transform rule emits the user's id in (`sub`, say),
   * with the user's `upn`; unset, its access tokens name no caller, as without the rule.
   */
  readonly callerClaim?: string
  /** Keycloak: the realm, the last segment of the issuer (`<serverUrl>/realms/<realm>`); default `pulse`. */
  readonly realm?: string
  /** Default: {@link FAKE_OIDC_CLIENT}, a confidential client. */
  readonly clients?: readonly FakeOidcClient[]
  /** Who can sign in; default {@link FAKE_OIDC_USERS}. */
  readonly users?: readonly FakeOidcUser[]
  /**
   * Keycloak: the `aud` of the access tokens, as its audience mapper sets it: Keycloak ignores the
   * RFC 8707 `resource` of a request. Unset, the tokens carry none, as without the mapper.
   */
  readonly audience?: string | readonly string[]
  /**
   * Keycloak: the audience mapper's "Add to ID token" too: the ID tokens' `aud` holds the
   * `audience` beside the client.
   */
  readonly audienceInIdToken?: boolean
  /** Entra ID: the tenant's id, the first segment of its authorities' paths. */
  readonly tenant?: string
  /** Entra ID: the API registration's client id, the `aud` of its v2 access tokens. */
  readonly apiClientId?: string
  /**
   * Entra ID: the API's App ID URIs, which a request's `resource` must name exactly, the first the
   * prefix of its scopes; default `api://<apiClientId>`.
   */
  readonly appIdUris?: readonly string[]
  /**
   * Entra ID: the API's `requestedAccessTokenVersion`, 2 by default; 1 gives v1 access tokens,
   * whose issuer is `https://sts.windows.net/<tenant>/`.
   */
  readonly tokenVersion?: 1 | 2
  /** Entra ID: the access tokens carry a `groups` claim of 200 group ids, as group claims do. */
  readonly groups?: boolean
  /** The access tokens' lifetime (default 300 s, Keycloak's). */
  readonly accessTokenSeconds?: number
  /** The refresh tokens' lifetime (default 1,800 s, Keycloak's session idle timeout). */
  readonly refreshTokenSeconds?: number
  /**
   * Keycloak's "Revoke Refresh Token": each refresh token renews once, and a reuse is refused.
   * ADFS never rotates its refresh tokens.
   */
  readonly rotateRefreshTokens?: boolean
  /**
   * Auth0's reuse detection: refresh tokens rotate, and a spent one used again revokes every
   * refresh token of its sign-in, the one its renewal gave too.
   */
  readonly revokeFamilyOnReuse?: boolean
  /** Whether a token answer carries a refresh token (default true): false, as without offline_access. */
  readonly refreshTokens?: boolean
}

/** The confidential client the fake registers unless told otherwise. */
export const FAKE_OIDC_CLIENT: FakeOidcClient = { id: "pulse-web", secret: "pulse-web-secret" }

/** The users the fake offers unless told otherwise; the first signs in when a test names none. */
export const FAKE_OIDC_USERS: readonly FakeOidcUser[] = [
  {
    sub: "11111111-1111-4111-8111-111111111111",
    username: "alice",
    name: "Alice Adams",
    email: "alice@example.test",
  },
  {
    sub: "22222222-2222-4222-8222-222222222222",
    username: "bob",
    name: "Bob Brown",
    email: "bob@example.test",
  },
]

/** A key the realm signs with: its public JWK, which names its `kid`, and its private key. */
export interface SigningKey {
  readonly jwk: JWK
  readonly privateKey: CryptoKey
}

/** Entra ID's tenant as the realm plays it (entra.ts). */
export interface EntraTenant {
  readonly tenant: string
  /** `<serverUrl>/<tenant>/oauth21/2026-08`: the authority beside the v2.0 one, the realm's issuer. */
  readonly oauth21Issuer: string
  readonly apiClientId: string
  readonly appIdUris: readonly string[]
  readonly tokenVersion: 1 | 2
  readonly groups: boolean
  /** The key only the oauth21 authority's key set holds, which signs that authority's tokens. */
  readonly oauth21Key: SigningKey
}

/** A code the authorization endpoint issued, good once for a minute. */
interface PendingCode {
  readonly clientId: string
  readonly redirectUri: string
  readonly challenge: string
  readonly scope: string
  /** The resource the request named (ADFS's audience of the code's access token). */
  readonly resource?: string
  readonly nonce?: string
  readonly user: FakeOidcUser
  readonly sid: string
  readonly expiresAt: number
}

/** A refresh token's grant: its session, whether it still renews, and whether it renewed once. */
export interface Grant {
  readonly clientId: string
  readonly scope: string
  readonly user: FakeOidcUser
  readonly sid: string
  readonly expiresAt: number
  active: boolean
  spent?: boolean
}

/** A session ended at the end-session endpoint: the client that asked, where it returned, which. */
export interface EndedSession {
  readonly clientId?: string
  readonly postLogoutRedirectUri?: string
  /** The session ended: the browser's session cookie's, else the ID token hint's. */
  readonly sid?: string
}

/** Every token the realm minted, so a test can look for one where none may appear. */
export interface IssuedTokens {
  readonly access: string[]
  readonly refresh: string[]
  readonly id: string[]
}

export interface Realm extends SigningKey {
  readonly flavor: FakeOidcFlavor
  readonly issuer: string
  /** The `iss` of its access tokens: the issuer, ADFS's `<issuer>/services/trust`. */
  readonly accessTokenIssuer: string
  /** ADFS: the claim its issuance transform rule names the caller in. */
  readonly callerClaim?: string
  readonly clients: ReadonlyMap<string, FakeOidcClient>
  readonly users: readonly FakeOidcUser[]
  readonly audience?: string | readonly string[]
  readonly audienceInIdToken: boolean
  /** Entra ID: its tenant, the API registration and the oauth21 authority's own key. */
  readonly entra?: EntraTenant
  readonly accessTokenSeconds: number
  readonly refreshTokenSeconds: number
  readonly rotateRefreshTokens: boolean
  readonly revokeFamilyOnReuse: boolean
  readonly refreshTokens: boolean
  readonly codes: Map<string, PendingCode>
  readonly grants: Map<string, Grant>
  readonly issued: IssuedTokens
  /** Every token sent to the revocation endpoint by a client it authenticated. */
  readonly revoked: string[]
  readonly endedSessions: EndedSession[]
  /** Every refresh grant is refused while set, as after the session ended at the provider. */
  refusingRefresh: boolean
}

/** The tenant and the API registration Entra ID's flavor plays unless told otherwise. */
export const ENTRA_TENANT = "4f1b6d0e-2c3a-4e5f-8a9b-0c1d2e3f4a5b"
export const ENTRA_API_CLIENT_ID = "7d2e9c41-6b3f-4a8e-9f10-2b3c4d5e6f70"

/** A new RS256 key named `kid`. */
async function signingKey(kid: string): Promise<SigningKey> {
  const { privateKey, publicKey } = await generateKeyPair("RS256")
  return { jwk: { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" }, privateKey }
}

/** Entra ID's tenant: the realm's issuer is its v2.0 authority, `<serverUrl>/<tenant>/v2.0`. */
async function entraTenantOf(issuer: string, options: FakeOidcOptions): Promise<EntraTenant> {
  const tenant = options.tenant ?? ENTRA_TENANT
  const apiClientId = options.apiClientId ?? ENTRA_API_CLIENT_ID
  return {
    tenant,
    oauth21Issuer: `${new URL(issuer).origin}/${tenant}/oauth21/2026-08`,
    apiClientId,
    appIdUris: options.appIdUris ?? [`api://${apiClientId}`],
    tokenVersion: options.tokenVersion ?? 2,
    groups: options.groups ?? false,
    oauth21Key: await signingKey("fake-oidc-oauth21"),
  }
}

/** The `iss` of a flavor's access tokens: the issuer, ADFS's `<issuer>/services/trust`. */
const accessTokenIssuerOf = (flavor: FakeOidcFlavor, issuer: string): string =>
  flavor === "adfs" ? `${issuer}/services/trust` : issuer

/** What only Keycloak's flavor plays: its audience mapper in ID tokens, rotation, reuse detection. */
function keycloakOptions(flavor: FakeOidcFlavor, options: FakeOidcOptions) {
  const keycloak = flavor === "keycloak"
  const reuseRevokes = keycloak && (options.revokeFamilyOnReuse ?? false)
  return {
    audienceInIdToken: keycloak && (options.audienceInIdToken ?? false),
    rotateRefreshTokens: keycloak && ((options.rotateRefreshTokens ?? false) || reuseRevokes),
    revokeFamilyOnReuse: reuseRevokes,
  }
}

export async function createRealm(issuer: string, options: FakeOidcOptions): Promise<Realm> {
  const clients = options.clients ?? [FAKE_OIDC_CLIENT]
  const flavor = options.flavor ?? "keycloak"
  return {
    flavor,
    issuer,
    accessTokenIssuer: accessTokenIssuerOf(flavor, issuer),
    ...(options.callerClaim === undefined ? {} : { callerClaim: options.callerClaim }),
    clients: new Map(clients.map((client) => [client.id, client])),
    users: options.users ?? FAKE_OIDC_USERS,
    ...(options.audience === undefined ? {} : { audience: options.audience }),
    ...keycloakOptions(flavor, options),
    ...(flavor === "entra" ? { entra: await entraTenantOf(issuer, options) } : {}),
    accessTokenSeconds: options.accessTokenSeconds ?? 300,
    refreshTokenSeconds: options.refreshTokenSeconds ?? 1800,
    refreshTokens: options.refreshTokens ?? true,
    ...(await signingKey("fake-oidc-rs256")),
    codes: new Map(),
    grants: new Map(),
    issued: { access: [], refresh: [], id: [] },
    revoked: [],
    endedSessions: [],
    refusingRefresh: false,
  }
}

export const opaqueToken = (): string => randomBytes(32).toString("base64url")

/** The S256 challenge of a PKCE verifier (RFC 7636 §4.2). */
export const s256 = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url")

const seconds = (ms: number): number => Math.floor(ms / 1000)

function profileClaims(user: FakeOidcUser): Record<string, string> {
  return {
    preferred_username: user.username,
    ...(user.name === undefined ? {} : { name: user.name }),
    ...(user.email === undefined ? {} : { email: user.email }),
  }
}

/**
 * A token of the realm's key (or `key`): `claims`, its issuer (the realm's unless named), now and
 * its end.
 */
export function sign(
  realm: Realm,
  claims: Record<string, unknown>,
  lifetime: number,
  issuer = realm.issuer,
  key: SigningKey = realm,
): Promise<string> {
  const now = seconds(Date.now())
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: key.jwk.kid })
    .setIssuer(issuer)
    .setIssuedAt(now)
    .setExpirationTime(now + lifetime)
    .setJti(randomUUID())
    .sign(key.privateKey)
}

/** The session of a token answer: its grant's client, scope, user and `sid`, and a nonce. */
export type IssuedSession = Omit<Grant, "expiresAt" | "active"> & { readonly nonce?: string }

/** A new refresh token of the session's grant. */
export function newRefreshToken(realm: Realm, session: IssuedSession): string {
  const { clientId, scope, user, sid } = session
  const refreshToken = opaqueToken()
  const expiresAt = Date.now() + realm.refreshTokenSeconds * 1000
  realm.grants.set(refreshToken, { clientId, scope, user, sid, expiresAt, active: true })
  realm.issued.refresh.push(refreshToken)
  return refreshToken
}

/** A new refresh token of the session's grant, as Keycloak's token answer carries it. */
function refreshAnswer(realm: Realm, session: IssuedSession) {
  const refreshToken = newRefreshToken(realm, session)
  return { refresh_expires_in: realm.refreshTokenSeconds, refresh_token: refreshToken }
}

/** An ID token's `at_hash`: the left half of the access token's SHA-256 (OpenID Connect Core 3.1.3.6). */
const atHash = (accessToken: string): string =>
  createHash("sha256").update(accessToken).digest().subarray(0, 16).toString("base64url")

/** An ID token's `aud`: the client, and the audience mapper's audience where it adds it there. */
function idTokenAudience(realm: Realm, clientId: string): string | string[] {
  const { audience } = realm
  if (!realm.audienceInIdToken || audience === undefined) return clientId
  return [clientId, ...(typeof audience === "string" ? [audience] : audience)]
}

/** A sign-in's or a refresh's tokens, as Keycloak's token endpoint answers them. */
export async function issueTokens(
  realm: Realm,
  session: IssuedSession,
): Promise<Record<string, unknown>> {
  const { clientId, scope, user, sid, nonce } = session
  const accessToken = await sign(
    realm,
    {
      sub: user.sub,
      typ: "Bearer",
      azp: clientId,
      sid,
      scope,
      ...(realm.audience === undefined ? {} : { aud: realm.audience }),
      ...profileClaims(user),
    },
    realm.accessTokenSeconds,
  )
  realm.issued.access.push(accessToken)
  const refresh = realm.refreshTokens ? refreshAnswer(realm, session) : {}
  const idToken = scope.split(" ").includes("openid")
    ? await sign(
        realm,
        {
          sub: user.sub,
          typ: "ID",
          aud: idTokenAudience(realm, clientId),
          azp: clientId,
          at_hash: atHash(accessToken),
          sid,
          ...(nonce ? { nonce } : {}),
          ...profileClaims(user),
        },
        realm.accessTokenSeconds,
      )
    : undefined
  if (idToken !== undefined) realm.issued.id.push(idToken)
  return {
    access_token: accessToken,
    expires_in: realm.accessTokenSeconds,
    ...refresh,
    token_type: "Bearer",
    ...(idToken === undefined ? {} : { id_token: idToken }),
    "not-before-policy": 0,
    session_state: sid,
    scope,
  }
}
