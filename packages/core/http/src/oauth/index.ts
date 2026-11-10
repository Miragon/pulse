/**
 * @miragon/pulse-http/oauth: the OAuth client protocol of every Pulse surface, on the
 * transport's wire. The token endpoint (every grant, revocation, the client's authentication and
 * the reading of a refusal), when a token is renewed (one policy for all), token sources that
 * renew (client credentials, a login's refresh token under a store's lock, a token command), the
 * store port, discovery, PKCE, the authorization request and its callback, and the claims of a
 * JWT. Where a secret or a token is kept, how a person logs in and every word a person reads stay
 * with each surface: failures are data (`TokenFailure`, the problems of discovery and callback).
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
  REFUSED_HOLD_MS,
  TokenFailure,
  type TokenFailureDetails,
  type TokenFailureKind,
  UNAVAILABLE_HOLD_MS,
} from "./failure.js"
export { MAX_TOKEN_ANSWER_BYTES, TOKEN_TIMEOUT_MS } from "./wire.js"
export { isAccessToken, requestToken, revokeToken } from "./token.js"
export { retryAfterMs } from "./retry-after.js"
export {
  canRefresh,
  EXPIRY,
  isDue,
  isExpired,
  marginOf,
  refreshAt,
  renewsAfterRefusal,
} from "./expiry.js"
export { memoryTokenStore, tokenKey } from "./store.js"
export { type ClientCredentialsOptions, clientCredentialsTokens } from "./client-credentials.js"
export { type RefreshingOptions, refreshingTokens } from "./refreshing.js"
export { type CommandOptions, commandTokens } from "./command.js"
export {
  type DiscoveryAnswer,
  discover,
  discoveryUrls,
  type MetadataNeeds,
  type MetadataProblem,
  oauthUrlProblem,
  type OAuthUrlProblem,
  type ServerMetadata,
  serverMetadata,
} from "./discovery.js"
export { base64Url, challengeOf, createPkce, type Pkce } from "./pkce.js"
export {
  type AuthorizationRequest,
  authorizationUrl,
  type CallbackProblem,
  callbackResult,
  type ExpectedCallback,
  safeEqual,
} from "./authorize.js"
export { decodeBase64Url, type JwtClaims, jwtClaims } from "./jwt.js"
