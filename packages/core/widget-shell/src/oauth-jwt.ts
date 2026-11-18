/**
 * The JWT verifier every table provider runs, on `jose`: the token's `iss` picks the one key set
 * its signature is checked with (asymmetric keys only), then the issuer, `exp`, the caller claim,
 * the RFC 8707 binding of `aud`/`resource` to this server and, where the provider names them, the
 * client. A JWT shaped like an ID, logout or refresh token is no access token, whoever signed it.
 * A key set the IdP cannot deliver, or one not found yet, is `temporarily_unavailable` (503 at the
 * gate), never a pass.
 */
import { OAuthError, OAuthErrorCode, type OAuthTokenVerifier } from "@modelcontextprotocol/server"
import {
  createRemoteJWKSet,
  customFetch,
  decodeJwt,
  decodeProtectedHeader,
  errors,
  jwtVerify,
  type FetchImplementation,
  type JWTVerifyGetKey,
  type JWTVerifyOptions,
  type ProtectedHeaderParameters,
} from "jose"
import {
  audienceRefusal,
  callerClaimOf,
  DEFAULT_CALLER_CLAIMS,
  invalidToken,
  isAllowedHttpUrl,
  isRecord,
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

/** One issuer's signing keys. */
export interface JwtKeySet {
  /** The issuer a token's `iss` names, exactly. */
  readonly issuer: string
  /** The key set's URL, or a lookup that finds it lazily: `undefined` while it is not known yet. */
  readonly jwks: URL | (() => Promise<URL | undefined>)
  /**
   * Its keys name the issuer they sign for (Microsoft's signing-key issuer rule, `{tenantid}`
   * standing for one tenant): a key that names another issuer is never used.
   */
  readonly taggedKeys?: boolean
}

export interface JwtVerifierOptions {
  /** One set per issuer a token may name; the token's unverified `iss` picks its set. */
  readonly keySets: readonly JwtKeySet[]
  /** This server: a `resource` claim must name it; else `aud` holds it or one of `audiences`. */
  readonly resource: URL
  /** What `aud` may hold besides the resource (an API's client id, say). */
  readonly audiences?: readonly string[]
  /** Narrows the algorithms; unset, each asymmetric key's own (`none` and secrets never verify). */
  readonly algorithms?: readonly string[]
  /** The claims that name the caller, the first a token carries; default `sub`. */
  readonly callerClaims?: readonly string[]
  /** A short `scp` value (no `/`) is read as `<scopePrefix>/<value>`. */
  readonly scopePrefix?: string
  /** The clients whose tokens pass; unset, every client's. */
  readonly clients?: readonly string[]
  /** `MCP_OAUTH_DEBUG`: log why a token was refused, never the token itself. */
  readonly debug?: boolean
}

const isAudienceList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string")

/**
 * The token's RFC 8707 binding: a `resource` claim must name this server exactly; without one,
 * `aud` (a string, or a non-empty array of strings only) must include it or another audience the
 * provider accepts. Each refusal is an audience refusal (`isAudienceRefusal`).
 */
function boundResource(claims: Claims, resource: URL, accepts: (audience: string) => boolean): URL {
  const claimed = claims.resource
  if (claimed !== undefined) {
    if (typeof claimed !== "string") {
      throw audienceRefusal("Token resource claim must be an absolute URL")
    }
    let url: URL
    try {
      url = new URL(claimed)
    } catch {
      throw audienceRefusal("Token resource claim must be an absolute URL")
    }
    if (!isAllowedHttpUrl(url) || trimPath(url).href !== resource.href) {
      throw audienceRefusal("Token resource claim does not match protected resource")
    }
    return resource
  }
  const { aud } = claims
  const audiences: unknown = typeof aud === "string" ? [aud] : aud
  // Every element a string: an array that mixes in another type is a malformed claim, so it is
  // refused whole rather than matched on its one string.
  if (!isAudienceList(audiences)) {
    throw audienceRefusal("Token audience claim must be a string or string array")
  }
  if (!audiences.some(accepts)) {
    throw audienceRefusal("Token audience does not include the protected resource")
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

/** 503 at the gate: the issuer's key set has not been found yet (its discovery did not answer). */
export const keysNotFound = (issuer: string): OAuthError =>
  new OAuthError(
    OAuthErrorCode.TemporarilyUnavailable,
    `The signing keys of ${issuer} are not known yet, so no token can be verified. Retry shortly.`,
  )

/** What a key's `issuer` tag holds in place of the one tenant it names (Microsoft's template). */
const TENANT = "{tenantid}"

/** Whether a key's `issuer` tag names `issuer`: its `{tenantid}` stands for the issuer's tenant. */
const tagNames = (tag: string, issuer: string): boolean =>
  tag.replace(TENANT, issuer.slice(tag.indexOf(TENANT)).split("/")[0]) === issuer

/** A key without a tag signs for its set's issuer; a tagged one only for the issuer it names. */
const signsFor =
  (issuer: string) =>
  (key: unknown): boolean => {
    const tag = isRecord(key) ? key.issuer : undefined
    return tag === undefined || (typeof tag === "string" && tagNames(tag, issuer))
  }

/**
 * The key set as `jose` reads it, without a key tagged for another issuer; an answer that is no
 * 200 or no key set goes to `jose` as it came, which refuses it in its own words.
 */
function taggedFetch(issuer: string): FetchImplementation {
  return async (url, init) => {
    const response = await fetch(url, init)
    const set: unknown =
      response.status === 200
        ? await response
            .clone()
            .json()
            .catch(() => undefined)
        : undefined
    if (!isRecord(set) || !Array.isArray(set.keys)) return response
    return Response.json({ ...set, keys: set.keys.filter(signsFor(issuer)) })
  }
}

/**
 * The issuer's key set (`jose` caches it and refetches on an unknown `kid` after a cooldown).
 * What the token asks for that the set does not hold stays the token's failure; any other error
 * is the set itself failing to load (unreachable, timeout, not 200, not JSON, malformed).
 */
function signingKeys(jwksUrl: URL, set: JwtKeySet): JWTVerifyGetKey {
  const remote = createRemoteJWKSet(
    jwksUrl,
    set.taggedKeys ? { [customFetch]: taggedFetch(set.issuer) } : undefined,
  )
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

type KeySource = () => Promise<JWTVerifyGetKey>

/** A set's keys: at its URL, or at the URL its lookup finds now, one remote set per URL found. */
function keySource(set: JwtKeySet): KeySource {
  const { jwks } = set
  if (jwks instanceof URL) {
    const keys = signingKeys(jwks, set)
    return () => Promise.resolve(keys)
  }
  let found: { href: string; keys: JWTVerifyGetKey } | undefined
  return async () => {
    const url = await jwks()
    if (url === undefined) throw keysNotFound(set.issuer)
    if (found?.href !== url.href) found = { href: url.href, keys: signingKeys(url, set) }
    return found.keys
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

/**
 * The token verified against the key set its unverified `iss` picks, and that issuer: an `iss` no
 * set names is refused before any key set loads, as `jose` refuses an issuer it was not told.
 */
async function verifiedByIssuer(
  token: string,
  sources: ReadonlyMap<string, KeySource>,
  options: JWTVerifyOptions,
) {
  const claims = decodeJwt(token)
  const source = sources.get(claims.iss as string)
  if (source === undefined) {
    throw new errors.JWTClaimValidationFailed(
      'unexpected "iss" claim value',
      claims,
      "iss",
      "check_failed",
    )
  }
  return verifyJwt(token, await source(), { ...options, issuer: claims.iss })
}

/** The claims that make a JWT an ID token (OpenID Connect) or a logout token (back-channel). */
const NOT_ACCESS_CLAIMS = ["at_hash", "c_hash", "events"]

/**
 * Keycloak's `typ` claim of an ID, refresh, offline or logout token; its access token's is
 * `Bearer`.
 */
const NOT_ACCESS_TYPES: ReadonlySet<string> = new Set(["id", "refresh", "offline", "logout"])

/** The media type of a logout token's `typ` header (OpenID Connect Back-Channel Logout). */
const NOT_ACCESS_MEDIA: ReadonlySet<string> = new Set(["logout+jwt", "application/logout+jwt"])

/**
 * What marks a JWT as an ID, logout or refresh token, which no client may present as an access
 * token: an `at_hash`, `c_hash` or `events` claim, Keycloak's `typ` claim, a `logout+jwt` header.
 * `nonce` is no mark, since some providers put it into access tokens.
 */
function notAccessMark(claims: Claims, header: ProtectedHeaderParameters): string | undefined {
  const claim = NOT_ACCESS_CLAIMS.find((name) => Object.hasOwn(claims, name))
  if (claim !== undefined) return `its ${claim} claim`
  const { typ } = claims
  if (typeof typ === "string" && NOT_ACCESS_TYPES.has(typ.toLowerCase())) {
    return `its typ claim ${typ}`
  }
  // No header is "undefined" here, which names no media type.
  const media = String(header.typ)
  return NOT_ACCESS_MEDIA.has(media.toLowerCase()) ? `its typ header ${media}` : undefined
}

/** A caller claim is required: a token without any names nobody, as `jose` refuses a missing one. */
function requireCaller(claims: Claims, names: readonly string[]): void {
  if (callerClaimOf(claims, names) !== undefined) return
  const claim = names.join(" or ")
  throw new errors.JWTClaimValidationFailed(
    `missing required "${claim}" claim`,
    claims,
    claim,
    "missing",
  )
}

/** The client a token was issued to, by the claims providers name it in, in this order. */
const CLIENT_CLAIMS = ["client_id", "azp", "appid", "cid"]

function clientOf(claims: Claims): string {
  for (const name of CLIENT_CLAIMS) {
    const client = nonBlank(claims, name)
    if (client !== undefined) return client
  }
  return ""
}

/** The scopes of `scope` and `scp`, each a string or an array; a short `scp` value prefixed. */
function scopesOf(claims: Claims, prefix: string | undefined): string[] {
  const scp = normalizedStrings(claims.scp)
  const read =
    prefix === undefined
      ? scp
      : scp.map((value) => (value.includes("/") ? value : `${prefix}/${value}`))
  return [...normalizedStrings(claims.scope), ...read]
}

/** The claims the checks read, never the token, its signature or the subject's value. */
const DEBUG_CLAIMS = [
  "iss",
  "aud",
  "resource",
  "azp",
  "client_id",
  "appid",
  "cid",
  "exp",
  "nbf",
  "iat",
  "scope",
  "scp",
  "ver",
  "tid",
  "idtyp",
  "typ",
]

function tokenSummary(token: string): string {
  try {
    const { alg, kid, typ } = decodeProtectedHeader(token)
    const claims = decodeJwt(token)
    // A claim the token lacks is `undefined` here, which JSON leaves out.
    const shown = Object.fromEntries(DEBUG_CLAIMS.map((name) => [name, claims[name]]))
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

export function createJwtVerifier(options: JwtVerifierOptions): OAuthTokenVerifier {
  const sources = new Map(options.keySets.map((set) => [set.issuer, keySource(set)]))
  const resource = trimPath(new URL(options.resource))
  const { audiences } = options
  const accepts = (audience: string): boolean =>
    audience === resource.href || audiences?.includes(audience) === true
  const callerClaims = options.callerClaims ?? DEFAULT_CALLER_CLAIMS
  const { clients, scopePrefix, algorithms } = options
  // Without `algorithms` the key set admits only asymmetric keys (a secret `alg` such as HS256
  // never resolves a key), each used with the algorithm its JWK names, and `none` never verifies.
  const verifyOptions: JWTVerifyOptions = {
    requiredClaims: ["exp"],
    clockTolerance: NOT_BEFORE_LEEWAY_SECONDS,
    ...(algorithms && { algorithms: [...algorithms] }),
  }
  return {
    async verifyAccessToken(token) {
      try {
        const verified = await verifiedByIssuer(token, sources, verifyOptions)
        const claims: Claims = { ...verified.payload }
        const mark = notAccessMark(claims, verified.protectedHeader)
        if (mark !== undefined) {
          throw invalidToken(
            `Token is an ID, logout or refresh token, not an access token (${mark})`,
          )
        }
        requireCaller(claims, callerClaims)
        // `jose` required `exp` as a number, with the leeway meant for `nbf`: here it is exact.
        const exp = Number(claims.exp)
        if (!(exp > Date.now() / 1000)) throw invalidToken("Missing or expired exp claim")
        const bound = boundResource(claims, resource, accepts)
        const clientId = clientOf(claims)
        if (clients !== undefined && !clients.includes(clientId)) {
          throw invalidToken("Token was issued to a client this server does not accept")
        }
        return {
          token,
          clientId,
          scopes: scopesOf(claims, scopePrefix),
          expiresAt: exp,
          extra: { payload: claims },
          resource: bound,
        }
      } catch (error) {
        if (options.debug) logRefusal(token, error)
        if (isCredentialFailure(error)) throw invalidToken("JWT verification failed", error)
        throw error
      }
    },
  }
}
