/**
 * @miragon/pulse-http/oauth: the OAuth client protocol of every Pulse surface, on the
 * transport's wire. The token endpoint (every grant, revocation, the client's authentication and
 * the reading of a refusal), when a token is renewed (one policy for all), whether it has expired
 * and whether a refresh token can renew it, token sources that renew (client credentials, a
 * login's refresh token under a store's lock, a token command), the store port, discovery, PKCE,
 * the authorization request and its callback, and the claims of a JWT. Where a secret or a token
 * is kept, how a person logs in and every word a person reads stay with each surface: failures are
 * data (`TokenFailure`, the problems of discovery and callback). The rules behind these (the
 * default limits and holds, the reading of `Retry-After`, the renewal margin, the discovery URLs,
 * PKCE's encoding, the constant-time compare) stay in their modules, where the package's tests
 * reach them.
 */

export type {
  ClientAuth,
  ExpiryPolicy,
  Grant,
  RefreshRejection,
  TokenEndpoint,
  TokenLimits,
  TokenRecord,
  TokenStore,
} from "./types.js"
export {
  type AnswerProblem,
  TokenFailure,
  type TokenFailureDetails,
  type TokenFailureKind,
} from "./failure.js"
export { isAccessToken, requestToken, revokeToken } from "./token.js"
export { canRefresh, EXPIRY, isDue, isExpired, refreshAt, renewsAfterRefusal } from "./expiry.js"
export { memoryTokenStore, tokenKey } from "./store.js"
export { type ClientCredentialsOptions, clientCredentialsTokens } from "./client-credentials.js"
export { type RefreshingOptions, refreshingTokens } from "./refreshing.js"
export { type CommandOptions, commandTokens } from "./command.js"
export {
  type DiscoveryAnswer,
  discover,
  type MetadataNeeds,
  type MetadataProblem,
  oauthUrlProblem,
  type OAuthUrlProblem,
  type ServerMetadata,
  serverMetadata,
} from "./discovery.js"
export { createPkce, type Pkce } from "./pkce.js"
export {
  type AuthorizationRequest,
  authorizationUrl,
  type CallbackProblem,
  callbackResult,
  type ExpectedCallback,
} from "./authorize.js"
export { decodeBase64Url, type JwtClaims, jwtClaims } from "./jwt.js"
