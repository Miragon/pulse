/**
 * The fake identity provider's realm: its settings, its users and clients, the codes and sessions
 * a sign-in leaves, and the tokens it mints, signed with its own RS256 key as Keycloak signs them.
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

export interface FakeOidcOptions {
  /** The realm, the last segment of the issuer (`<serverUrl>/realms/<realm>`); default `pulse`. */
  readonly realm?: string
  /** Default: {@link FAKE_OIDC_CLIENT}, a confidential client. */
  readonly clients?: readonly FakeOidcClient[]
  /** Who can sign in; default {@link FAKE_OIDC_USERS}. */
  readonly users?: readonly FakeOidcUser[]
  /**
   * The `aud` of the access tokens, as Keycloak's audience mapper sets it: Keycloak ignores the
   * RFC 8707 `resource` of a request. Unset, the tokens carry none, as without the mapper.
   */
  readonly audience?: string | readonly string[]
  /** The access tokens' lifetime (default 300 s, Keycloak's). */
  readonly accessTokenSeconds?: number
  /** The refresh tokens' lifetime (default 1,800 s, Keycloak's session idle timeout). */
  readonly refreshTokenSeconds?: number
  /** Keycloak's "Revoke Refresh Token": each refresh token renews once, and a reuse is refused. */
  readonly rotateRefreshTokens?: boolean
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

/** A code the authorization endpoint issued, good once for a minute. */
interface PendingCode {
  readonly clientId: string
  readonly redirectUri: string
  readonly challenge: string
  readonly scope: string
  readonly nonce?: string
  readonly user: FakeOidcUser
  readonly sid: string
  readonly expiresAt: number
}

/** A refresh token's grant: its session, and whether it still renews. */
export interface Grant {
  readonly clientId: string
  readonly scope: string
  readonly user: FakeOidcUser
  readonly sid: string
  readonly expiresAt: number
  active: boolean
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

export interface Realm {
  readonly issuer: string
  readonly clients: ReadonlyMap<string, FakeOidcClient>
  readonly users: readonly FakeOidcUser[]
  readonly audience?: string | readonly string[]
  readonly accessTokenSeconds: number
  readonly refreshTokenSeconds: number
  readonly rotateRefreshTokens: boolean
  readonly jwk: JWK
  readonly privateKey: CryptoKey
  readonly codes: Map<string, PendingCode>
  readonly grants: Map<string, Grant>
  readonly issued: IssuedTokens
  /** Every token sent to the revocation endpoint by a client it authenticated. */
  readonly revoked: string[]
  readonly endedSessions: EndedSession[]
  /** Every refresh grant is refused while set, as after the session ended at the provider. */
  refusingRefresh: boolean
}

const KID = "fake-oidc-rs256"

export async function createRealm(issuer: string, options: FakeOidcOptions): Promise<Realm> {
  const { privateKey, publicKey } = await generateKeyPair("RS256")
  const clients = options.clients ?? [FAKE_OIDC_CLIENT]
  return {
    issuer,
    clients: new Map(clients.map((client) => [client.id, client])),
    users: options.users ?? FAKE_OIDC_USERS,
    ...(options.audience === undefined ? {} : { audience: options.audience }),
    accessTokenSeconds: options.accessTokenSeconds ?? 300,
    refreshTokenSeconds: options.refreshTokenSeconds ?? 1800,
    rotateRefreshTokens: options.rotateRefreshTokens ?? false,
    jwk: { ...(await exportJWK(publicKey)), kid: KID, alg: "RS256", use: "sig" },
    privateKey,
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

function sign(realm: Realm, claims: Record<string, unknown>, lifetime: number): Promise<string> {
  const now = seconds(Date.now())
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: KID })
    .setIssuer(realm.issuer)
    .setIssuedAt(now)
    .setExpirationTime(now + lifetime)
    .setJti(randomUUID())
    .sign(realm.privateKey)
}

/** A sign-in's or a refresh's tokens, as Keycloak's token endpoint answers them. */
export async function issueTokens(
  realm: Realm,
  session: Omit<Grant, "expiresAt" | "active"> & { readonly nonce?: string },
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
  const refreshToken = opaqueToken()
  realm.grants.set(refreshToken, {
    clientId,
    scope,
    user,
    sid,
    expiresAt: Date.now() + realm.refreshTokenSeconds * 1000,
    active: true,
  })
  realm.issued.access.push(accessToken)
  realm.issued.refresh.push(refreshToken)
  const idToken = scope.split(" ").includes("openid")
    ? await sign(
        realm,
        {
          sub: user.sub,
          aud: clientId,
          azp: clientId,
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
    refresh_expires_in: realm.refreshTokenSeconds,
    refresh_token: refreshToken,
    token_type: "Bearer",
    ...(idToken === undefined ? {} : { id_token: idToken }),
    "not-before-policy": 0,
    session_state: sid,
    scope,
  }
}
