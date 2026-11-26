/**
 * The generic OpenID Connect provider (`MCP_OAUTH_OIDC_*`), for an identity provider the table does
 * not name: ADFS 2019 and later, Okta's custom authorization servers, authentik, Zitadel, PingOne,
 * any that issues JWT access tokens signed with an asymmetric key and names its key set in its
 * discovery. The issuer is taken exactly as the discovery names it (authentik's ends in a slash).
 * The gate reads the key set and the issuer its access tokens carry (ADFS's `access_token_issuer`
 * beside the issuer) from the provider's discovery at the first token, held an hour and kept after
 * a failed re-read; before its first answer every token gets 503. Its metadata names the issuer
 * alone, so the protected resource metadata names it and there is no copy of the authorization
 * server's metadata (MCP clients read the provider's own). The web sign-in reads the same
 * discovery and asks `openid` and the required scopes, unless `MCP_WEB_SCOPES` names others, for
 * the gate's resource, or for the Web API's identifier where an audience is ADFS's for it.
 *
 * A token must carry the claims `MCP_OAUTH_OIDC_REQUIRED_CLAIMS` names, such as Keycloak's `sid`
 * and `auth_time`, which only a signed-in user's token carries: where clients may register
 * themselves, a token a client obtained for itself (client credentials) names no user and would
 * pass otherwise.
 *
 * What it refuses at boot: an issuer off https (http only on the machine itself), a caller claim
 * whose value can change (an address or a name another person may get later), an algorithm that
 * signs with a shared secret or not at all, and an audience that is no https URL without a
 * required scope beyond OpenID Connect's own (`openid`, `profile` …, which every sign-in's token
 * carries), since a client's id (an ID token's audience) or another app's id can be one, and an
 * audience every app of a provider shares (Okta's `api://default`) is one. ADFS's audience of a
 * Web API (`microsoft:identityserver:<identifier>`) needs none: only that Web API's access tokens
 * carry it.
 */
import type { OAuthTokenVerifier } from "@modelcontextprotocol/server"
import {
  NETWORK,
  providerDiscovery,
  type DiscoveryPlatform,
  type GateKeys,
  type KeySource,
} from "./oauth-discovery.js"
import { createJwtVerifier, keysNotFound, type JwtKeySet } from "./oauth-jwt.js"
import {
  mapSubject,
  type OAuthProvider,
  type OAuthWebClient,
  type ProviderOptions,
} from "./oauth-providers.js"
import { isAllowedHttpUrl, isLocalhost } from "./oauth-shared.js"

/** The provider's variables: the issuer is required, the others optional. */
export const OIDC_ENV = {
  issuer: "MCP_OAUTH_OIDC_ISSUER",
  audience: "MCP_OAUTH_OIDC_AUDIENCE",
  scopes: "MCP_OAUTH_OIDC_SCOPES",
  subjectClaim: "MCP_OAUTH_OIDC_SUBJECT_CLAIM",
  algorithms: "MCP_OAUTH_OIDC_ALGORITHMS",
  clientIds: "MCP_OAUTH_OIDC_CLIENT_IDS",
  requiredClaims: "MCP_OAUTH_OIDC_REQUIRED_CLAIMS",
} as const

/** The values of the optional variables, each `undefined` when unset. */
type OidcValues = Readonly<Partial<Record<Exclude<keyof typeof OIDC_ENV, "issuer">, string>>>

interface OidcSettings {
  /** Exactly as the provider's discovery names it. */
  readonly issuer: string
  /** What `aud` may hold besides the gate's resource, which always passes. */
  readonly audiences: readonly string[]
  /** The scopes every token must carry, as it carries them. */
  readonly scopes: readonly string[]
  /** The claim that names the caller. */
  readonly subjectClaim: string
  /** Narrows the algorithms; unset, each asymmetric key's own. */
  readonly algorithms?: readonly string[]
  /** The clients whose tokens pass, the web sign-in's among them; unset, every client's. */
  readonly clients?: readonly string[]
  /** The claims every token must carry besides the caller's (Keycloak's `sid` and `auth_time`). */
  readonly requiredClaims: readonly string[]
}

/** Claims whose value can change or pass to another person: never the caller. */
const MUTABLE_CLAIMS: ReadonlySet<string> = new Set([
  "email",
  "upn",
  "unique_name",
  "preferred_username",
  "name",
])

/**
 * OpenID Connect's own scopes (Core 1.0 §5.4, §11): every sign-in's token may carry them, whichever
 * app it was issued to, so none of them tells Pulse's tokens from another app's.
 */
const OIDC_STANDARD_SCOPES: ReadonlySet<string> = new Set([
  "openid",
  "profile",
  "email",
  "address",
  "phone",
  "offline_access",
])

/** The asymmetric signature algorithms the verifier knows (`jose`'s). */
const ASYMMETRIC_ALGORITHMS: readonly string[] = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
  "Ed25519",
  "ML-DSA-44",
  "ML-DSA-65",
  "ML-DSA-87",
]

/** The entries of a list variable: separated by commas or spaces. */
export function listOf(name: string, raw: string): string[] {
  const entries = raw.split(/[\s,]/).filter(Boolean)
  if (entries.length === 0) throw new Error(`${name} holds no value.`)
  return entries
}

function issuerOf(raw: string): string {
  if (URL.canParse(raw) && !/[?#]/.test(raw) && isAllowedHttpUrl(new URL(raw))) return raw
  throw new Error(
    `${OIDC_ENV.issuer} must be an absolute https URL (http only on localhost) without ` +
      "credentials, query or fragment, exactly as the provider's discovery names its issuer.",
  )
}

/**
 * ADFS's audience of a Web API whose identifier is no URI (its wizard proposes the client's id):
 * the identifier behind this prefix. Only the access tokens for that one Web API carry it, since a
 * farm gives an identifier to one relying party alone, and an ID token names its client's id bare.
 */
const ADFS_AUDIENCE_PREFIX = "microsoft:identityserver:"

/**
 * An audience no client's or app's id can be: an https URL, http on the machine itself, or ADFS's
 * audience of a Web API.
 */
function isBoundAudience(audience: string): boolean {
  if (audience.startsWith(ADFS_AUDIENCE_PREFIX)) {
    return audience.length > ADFS_AUDIENCE_PREFIX.length
  }
  if (!URL.canParse(audience)) return false
  const url = new URL(audience)
  return url.protocol === "https:" || (url.protocol === "http:" && isLocalhost(url))
}

function audiencesOf(raw: string | undefined, scopes: readonly string[]): string[] {
  if (raw === undefined) return []
  const audiences = listOf(OIDC_ENV.audience, raw)
  const bare = audiences.find((audience) => !isBoundAudience(audience))
  const own = scopes.filter((scope) => !OIDC_STANDARD_SCOPES.has(scope))
  if (bare !== undefined && own.length === 0) {
    throw new Error(
      `${OIDC_ENV.audience} names "${bare}", which is no https URL and no ADFS audience of a ` +
        `Web API (${ADFS_AUDIENCE_PREFIX}<identifier>): a client's id (the audience ` +
        "of its ID tokens), another app's id or an audience every app shares (Okta's " +
        "api://default) can be such an audience, so its tokens need a scope only Pulse's " +
        `clients are granted. Name that scope in ${OIDC_ENV.scopes}: OpenID Connect's own ` +
        `(${[...OIDC_STANDARD_SCOPES].join(", ")}) are in every sign-in's token.`,
    )
  }
  return audiences
}

function subjectClaimOf(raw: string | undefined): string {
  if (raw === undefined) return "sub"
  if (/[\s,]/.test(raw)) throw new Error(`${OIDC_ENV.subjectClaim} must name one claim.`)
  if (MUTABLE_CLAIMS.has(raw.toLowerCase())) {
    throw new Error(
      `${OIDC_ENV.subjectClaim} "${raw}" names a claim whose value can change or pass to ` +
        "another person (an address or a name), so it cannot name the caller: name an id the " +
        "provider never reuses, such as sub, oid or uid.",
    )
  }
  return raw
}

/** Why an algorithm is refused: a secret or no signature, or one the verifier does not know. */
function algorithmProblem(algorithm: string): string | undefined {
  if (/^HS/i.test(algorithm)) return "signs with a secret the server would share"
  if (algorithm.toLowerCase() === "none") return "signs nothing"
  return ASYMMETRIC_ALGORITHMS.includes(algorithm) ? undefined : "is no algorithm the gate knows"
}

function algorithmsOf(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined
  const algorithms = listOf(OIDC_ENV.algorithms, raw)
  for (const algorithm of algorithms) {
    const problem = algorithmProblem(algorithm)
    if (problem === undefined) continue
    throw new Error(
      `${OIDC_ENV.algorithms} names ${algorithm}, which ${problem}: name asymmetric ` +
        `algorithms only (${ASYMMETRIC_ALGORITHMS.join(", ")}).`,
    )
  }
  return algorithms
}

/** The allowlist, and the web sign-in's client on it, whose tokens the gate must take. */
function clientsOf(raw: string | undefined, webClientId: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined
  const clients = listOf(OIDC_ENV.clientIds, raw)
  return webClientId === undefined ? clients : [...new Set([...clients, webClientId])]
}

/** The claims every token must carry besides the caller claim, which it carries anyway. */
function requiredClaimsOf(raw: string | undefined, subjectClaim: string): string[] {
  if (raw === undefined) return []
  return [...new Set(listOf(OIDC_ENV.requiredClaims, raw))].filter(
    (claim) => claim !== subjectClaim,
  )
}

/**
 * The provider's settings from its variables (trimmed, a blank one unset), or the first reason
 * they cannot work. `webClientId` is `MCP_WEB_CLIENT_ID`, which joins a client allowlist.
 */
export function readOidcSettings(
  issuer: string,
  values: OidcValues,
  webClientId?: string,
): OidcSettings {
  const exact = issuerOf(issuer)
  const scopes = values.scopes === undefined ? [] : listOf(OIDC_ENV.scopes, values.scopes)
  const audiences = audiencesOf(values.audience, scopes)
  const subjectClaim = subjectClaimOf(values.subjectClaim)
  const algorithms = algorithmsOf(values.algorithms)
  const clients = clientsOf(values.clientIds, webClientId)
  const requiredClaims = requiredClaimsOf(values.requiredClaims, subjectClaim)
  return {
    issuer: exact,
    audiences,
    scopes,
    subjectClaim,
    requiredClaims,
    ...(algorithms && { algorithms }),
    ...(clients && { clients }),
  }
}

/** What the generic provider takes besides its settings. */
interface OidcOptions extends ProviderOptions {
  /** One line of the server's log: what the discovery found missing. */
  readonly log: (line: string) => void
  /** What the discovery fetches through; the network by default. */
  readonly platform?: DiscoveryPlatform
}

/**
 * One set per issuer a token may carry, both at the key set the discovery names: the issuer, and
 * the access tokens' issuer where the discovery names one (ADFS).
 */
function keySetsOf(keys: GateKeys): JwtKeySet[] {
  const jwks = new URL(keys.jwksUri)
  const { issuer, accessTokenIssuer } = keys
  const issuers = accessTokenIssuer === undefined ? [issuer] : [issuer, accessTokenIssuer]
  return issuers.map((named) => ({ issuer: named, jwks }))
}

/**
 * A verifier over what the discovery found: 503 before its first answer, and the verifier built
 * for what it found, anew when a read finds it anew.
 */
function discoveredVerifier(
  keys: KeySource,
  issuer: string,
  build: (found: GateKeys) => OAuthTokenVerifier,
): OAuthTokenVerifier {
  let built: { readonly found: GateKeys; readonly verifier: OAuthTokenVerifier } | undefined
  return {
    async verifyAccessToken(token) {
      const found = await keys()
      if (found === undefined) throw keysNotFound(issuer)
      if (built?.found !== found) built = { found, verifier: build(found) }
      return built.verifier.verifyAccessToken(token)
    },
  }
}

/** The boot line's words for what a token must carry besides its caller claim. */
function describeTokens(settings: OidcSettings, resource: URL): string {
  const { audiences, scopes, clients } = settings
  const aud = [`aud ${resource.href} (RFC 8707)`, ...audiences].join(" or ")
  const noun = scopes.length === 1 ? "scope" : "scopes"
  const scope = scopes.length === 0 ? [] : [`the ${noun} ${scopes.join(" and ")}`]
  const client = clients === undefined ? [] : [`a client id ${clients.join(" or ")}`]
  return [aud, ...scope, ...client].join(", ")
}

/** The boot line's words for the caller claim and the claims required beside it. */
function describeClaims({ subjectClaim, requiredClaims }: OidcSettings): string {
  const claims = [subjectClaim, ...requiredClaims]
  if (claims.length === 1) return `the ${subjectClaim} claim`
  return `the ${claims.slice(0, -1).join(", ")} and ${claims.at(-1)} claims`
}

/**
 * The web sign-in where an audience is ADFS's for a Web API: it asks for that Web API's identifier,
 * which ADFS knows where it knows no URL, in place of the gate's resource; else the default.
 */
function webClientOf(audiences: readonly string[]): OAuthWebClient | undefined {
  const adfs = audiences.find((audience) => audience.startsWith(ADFS_AUDIENCE_PREFIX))
  if (adfs === undefined) return undefined
  return { scopes: ["openid"], resource: adfs.slice(ADFS_AUDIENCE_PREFIX.length) }
}

/** The generic OpenID Connect provider over its settings. */
export function oauthOidcProvider(settings: OidcSettings, options: OidcOptions): OAuthProvider {
  const { issuer, audiences, scopes, subjectClaim, algorithms, clients, requiredClaims } = settings
  const discovery = providerDiscovery(issuer, options.platform ?? NETWORK, options.log)
  const callerClaims = [subjectClaim]
  const web = webClientOf(audiences)
  return {
    oauthMetadata: { issuer },
    requiredScopes: scopes,
    callerClaims,
    ...(web && { web }),
    describeAudience: (resource) => describeTokens(settings, resource),
    describeCaller: () => describeClaims(settings),
    discovery,
    createTokenVerifier: (resource) =>
      discoveredVerifier(discovery.keys, issuer, (found) =>
        createJwtVerifier({
          keySets: keySetsOf(found),
          resource,
          audiences,
          callerClaims,
          requiredClaims,
          ...(algorithms && { algorithms }),
          ...(clients && { clients }),
          debug: options.debug,
        }),
      ),
    mapAuthInfo: mapSubject("OpenID Connect", callerClaims),
  }
}
