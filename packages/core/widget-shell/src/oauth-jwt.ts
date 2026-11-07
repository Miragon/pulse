/**
 * The JWT verifier every table provider runs, on `jose`: the signature against the issuer's key
 * set (asymmetric only), the issuer, `exp`, `sub` and the RFC 8707 binding of `aud`/`resource` to
 * this server. A key set the IdP cannot deliver is `temporarily_unavailable` (503 at the gate),
 * never a pass.
 */
import { OAuthError, OAuthErrorCode, type OAuthTokenVerifier } from "@modelcontextprotocol/server"
import {
  createRemoteJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  errors,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTVerifyOptions,
} from "jose"
import {
  invalidToken,
  isAllowedHttpUrl,
  nonBlank,
  normalizedStrings,
  trimPath,
  type Claims,
} from "./oauth-shared.js"

/**
 * A token whose `nbf` lies this far ahead still verifies: an IdP clock a few seconds ahead would
 * refuse its freshest tokens. `exp` gets no leeway, it is checked exactly (here and by the SDK).
 */
export const NOT_BEFORE_LEEWAY_SECONDS = 30

const isAudienceList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string")

/**
 * The token's RFC 8707 binding: a `resource` claim must name this server exactly; without one,
 * `aud` (a string, or a non-empty array of strings only) must include it.
 */
function boundResource(claims: Claims, resource: URL): URL {
  const claimed = claims.resource
  if (claimed !== undefined) {
    if (typeof claimed !== "string") {
      throw invalidToken("Token resource claim must be an absolute URL")
    }
    let url: URL
    try {
      url = new URL(claimed)
    } catch {
      throw invalidToken("Token resource claim must be an absolute URL")
    }
    if (!isAllowedHttpUrl(url) || trimPath(url).href !== resource.href) {
      throw invalidToken("Token resource claim does not match protected resource")
    }
    return resource
  }
  const { aud } = claims
  const audiences: unknown = typeof aud === "string" ? [aud] : aud
  // Every element a string: an array that mixes in another type is a malformed claim, so it is
  // refused whole rather than matched on its one string.
  if (!isAudienceList(audiences)) {
    throw invalidToken("Token audience claim must be a string or string array")
  }
  if (!audiences.includes(resource.href)) {
    throw invalidToken("Token audience does not include the protected resource")
  }
  return resource
}

/** A token that fails on its own terms: 401, whatever the key set holds. */
function isCredentialFailure(error: unknown): boolean {
  return (
    error instanceof errors.JWTClaimValidationFailed ||
    error instanceof errors.JWTExpired ||
    error instanceof errors.JOSEAlgNotAllowed ||
    error instanceof errors.JOSENotSupported ||
    error instanceof errors.JWSInvalid ||
    error instanceof errors.JWTInvalid ||
    error instanceof errors.JWSSignatureVerificationFailed ||
    error instanceof errors.JWKSNoMatchingKey
  )
}

function failureReason(error: unknown): string {
  if (error instanceof errors.JWKSTimeout) return "the request timed out"
  if (!(error instanceof Error)) return String(error)
  const code = (error.cause as { code?: unknown } | undefined)?.code
  return typeof code === "string" ? `${error.message} (${code})` : error.message
}

/** 503 at the gate: no token can be verified while the IdP does not deliver its keys. */
function keysUnavailable(jwksUrl: URL, cause: unknown): OAuthError {
  const error = new OAuthError(
    OAuthErrorCode.TemporarilyUnavailable,
    `The identity provider's signing keys could not be loaded from ${jwksUrl.href} ` +
      `(${failureReason(cause)}), so no token can be verified. Retry shortly.`,
  )
  ;(error as { cause?: unknown }).cause = cause
  return error
}

/**
 * The issuer's key set (`jose` caches it and refetches on an unknown `kid` after a cooldown).
 * What the token asks for that the set does not hold stays the token's failure; any other error
 * is the set itself failing to load (unreachable, timeout, not 200, not JSON, malformed).
 */
function signingKeys(jwksUrl: URL): JWTVerifyGetKey {
  const remote = createRemoteJWKSet(jwksUrl)
  return async (header, token) => {
    try {
      return await remote(header, token)
    } catch (error) {
      if (
        error instanceof errors.JWKSNoMatchingKey ||
        error instanceof errors.JWKSMultipleMatchingKeys ||
        error instanceof errors.JOSENotSupported
      ) {
        throw error
      }
      throw keysUnavailable(jwksUrl, error)
    }
  }
}

/**
 * `jwtVerify`, plus the one case `jose` hands back: a token without `kid` that several keys of its
 * type could have signed is tried against each of them.
 */
async function verifyJwt(token: string, key: JWTVerifyGetKey, options: JWTVerifyOptions) {
  try {
    return await jwtVerify(token, key, options)
  } catch (error) {
    if (!(error instanceof errors.JWKSMultipleMatchingKeys)) throw error
    for await (const candidate of error) {
      try {
        return await jwtVerify(token, candidate, options)
      } catch (failure) {
        if (!(failure instanceof errors.JWSSignatureVerificationFailed)) throw failure
      }
    }
    throw new errors.JWSSignatureVerificationFailed()
  }
}

/** The claims the checks read, never the token, its signature or the subject's value. */
const DEBUG_CLAIMS = ["iss", "aud", "resource", "azp", "client_id", "exp", "nbf", "iat", "scope"]

function tokenSummary(token: string): string {
  try {
    const { alg, kid, typ } = decodeProtectedHeader(token)
    const claims = decodeJwt(token)
    const shown = Object.fromEntries(
      DEBUG_CLAIMS.filter((name) => name in claims).map((name) => [name, claims[name]]),
    )
    const sub = typeof claims.sub === "string" ? "set" : "missing"
    const now = Math.floor(Date.now() / 1000)
    return JSON.stringify({ header: { alg, kid, typ }, ...shown, sub, now })
  } catch {
    return "not a decodable JWT"
  }
}

/** `MCP_OAUTH_DEBUG`: why a token was refused, never the token. */
function logRefusal(token: string, error: unknown): void {
  const name = error instanceof Error ? error.constructor.name : typeof error
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[oauth-debug] JWT verify failed: ${name}: ${message}`)
  if (error instanceof errors.JWTClaimValidationFailed) {
    console.error(`[oauth-debug] claim=${error.claim} reason=${error.reason}`)
  }
  console.error(`[oauth-debug] token=${tokenSummary(token)}`)
}

export function createJwtVerifier(options: {
  issuer: string
  jwksUrl: URL
  resource: URL
  debug?: boolean
}): OAuthTokenVerifier {
  const key = signingKeys(options.jwksUrl)
  const resource = trimPath(new URL(options.resource))
  // No `algorithms` list: the key set admits only asymmetric keys (a secret `alg` such as HS256
  // never resolves a key), each used with the algorithm its JWK names, and `none` never verifies.
  const verifyOptions: JWTVerifyOptions = {
    issuer: options.issuer,
    requiredClaims: ["exp", "sub"],
    clockTolerance: NOT_BEFORE_LEEWAY_SECONDS,
  }
  return {
    async verifyAccessToken(token) {
      try {
        const { payload } = await verifyJwt(token, key, verifyOptions)
        const claims: Claims = { ...payload }
        const exp = claims.exp
        // Exact: the leeway above is for `nbf` only.
        if (typeof exp !== "number" || exp <= Date.now() / 1000) {
          throw invalidToken("Missing or expired exp claim")
        }
        return {
          token,
          clientId: nonBlank(claims, "client_id") ?? nonBlank(claims, "azp") ?? "",
          scopes: normalizedStrings(claims.scope),
          expiresAt: exp,
          extra: { payload: claims },
          resource: boundResource(claims, resource),
        }
      } catch (error) {
        if (options.debug) logRefusal(token, error)
        if (error instanceof OAuthError) throw error
        if (isCredentialFailure(error)) throw invalidToken("JWT verification failed", error)
        throw error
      }
    },
  }
}
