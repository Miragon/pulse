/**
 * The types of the OAuth client: a token endpoint and its client, the grants, the token a grant
 * gives, the policy of when to renew it and the store it is kept in.
 */

/**
 * How a client authenticates at the token endpoint (RFC 6749 §2.3.1): `basic` (client_secret_basic,
 * id and secret form-encoded in an Authorization header) or `post` (client_secret_post, both in
 * the form) for a confidential client; `none` for a public client, whose id goes into the form.
 */
export type ClientAuth = "basic" | "post" | "none"

/** A token endpoint and the client that asks it. */
export interface TokenEndpoint {
  /** The endpoint's URL, checked by the caller (https, or http on a loopback host). */
  readonly url: string
  readonly clientId: string
  /** The confidential client's secret; sent only with `basic` or `post`. */
  readonly clientSecret?: string
  readonly clientAuth: ClientAuth
}

/** What the token endpoint is asked for. */
export type Grant =
  | {
      readonly type: "client_credentials"
      readonly audience?: string
      readonly scopes?: readonly string[]
    }
  /** Without a scope, so the original grant is kept. */
  | { readonly type: "refresh_token"; readonly refreshToken: string }
  /** The code of a login, with the redirect URI and the PKCE verifier as sent. */
  | {
      readonly type: "authorization_code"
      readonly code: string
      readonly redirectUri: string
      readonly verifier: string
    }

/** A refresh token the authorization server refused: recorded, so no request asks again. */
export interface RefreshRejection {
  readonly at: number
  /** The answer's `error` as sent, unchecked. */
  readonly error: string
  /** The answer's `error_description` as sent, unchecked. */
  readonly description?: string | undefined
}

/**
 * A token as the endpoint gave it. Every time is epoch ms by the local clock: a lifetime counts
 * from the receipt, never from a claim or the server's clock.
 */
export interface TokenRecord {
  /** An RFC 6750 b64token, so it is sent as it is. */
  readonly accessToken: string
  readonly receivedAt: number
  /** When it expires: the receipt plus the answer's expires_in; none when unknown. */
  readonly expiresAt?: number | undefined
  readonly refreshToken?: string | undefined
  /** When the refresh token expires (Keycloak's refresh_expires_in); none when unknown. */
  readonly refreshExpiresAt?: number | undefined
  readonly scope?: string | undefined
  /** The ID token as received, unchecked: for display only (`jwtClaims`). */
  readonly idToken?: string | undefined
  readonly refreshRejected?: RefreshRejection | undefined
}

/** The limits of one request to an authorization server. */
export interface TokenLimits {
  /** From sending to the last byte of the answer: 30 s by default. */
  readonly timeoutMs?: number
  /** The largest answer: 1 MiB by default. */
  readonly maxAnswerBytes?: number
}

/**
 * When a token is renewed: `max(floorMs, min(maxMarginMs, lifetime × lifetimeShare))` before it
 * expires, a lifetime of `defaultLifetimeS` when the answer names none, and after a 401 only a
 * token at least `youngTokenMs` old (a token that young was refused for another reason, a wrong
 * audience, which a new token does not mend).
 */
export interface ExpiryPolicy {
  readonly maxMarginMs: number
  readonly lifetimeShare: number
  readonly floorMs: number
  readonly defaultLifetimeS?: number
  readonly youngTokenMs: number
}

/**
 * Where tokens are kept, by key (`tokenKey`, never a secret in clear): memory in a server or an
 * editor, files under a lock in the CLI.
 */
export interface TokenStore {
  read(key: string): Promise<TokenRecord | undefined>
  write(key: string, record: TokenRecord): Promise<void>
  /**
   * Runs `work` while no other holder of the key's lock runs: one process (or window) renews a
   * token at a time. A store that cannot take its lock throws before `work` starts, and the
   * caller keeps a still valid token then.
   */
  exclusive<T>(key: string, work: () => Promise<T>): Promise<T>
}
