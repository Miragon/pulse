/**
 * The authorization server's metadata: OpenID Connect discovery with the RFC 8414 location as
 * fallback, and two checks of the document, each by its own needs, so what a sign-in needs never
 * blocks what verifying a token needs. Both take only a document that names exactly the expected
 * issuer (RFC 8414 §3.3). A client signs in by `serverMetadata`: PKCE with S256 when the document
 * lists methods, a client authentication the client can do, endpoints on https or plain http on a
 * loopback host (the caller's rule, so every surface keeps one definition of loopback), on a
 * loopback host only when the issuer is on one, so a remote document never sends the client's
 * secret, a code or a refresh token to the client's own machine; an endpoint a client can do
 * without (revocation, end session) is dropped when it fails those rules. A resource server
 * verifies tokens by `keyMetadata`: the key set's URL by the same rules, and the issuer its access
 * tokens carry.
 */
import type { Platform } from "../types.js"
import { withoutTrailingSlashes } from "../url.js"
import type { TokenLimits } from "./types.js"
import { exchange } from "./wire.js"

const OIDC_PATH = "/.well-known/openid-configuration"
const RFC8414_PATH = "/.well-known/oauth-authorization-server"

/** The two discovery locations of an issuer: OpenID Connect first, then RFC 8414 §3.1. */
export function discoveryUrls(issuer: string): readonly [oidc: string, rfc8414: string] {
  const trimmed = withoutTrailingSlashes(issuer)
  const url = new URL(trimmed)
  const path = url.pathname === "/" ? "" : url.pathname
  return [`${trimmed}${OIDC_PATH}`, `${url.origin}${RFC8414_PATH}${path}`]
}

/** One answer of a discovery location. */
export interface DiscoveryAnswer {
  readonly url: string
  readonly status: number
  readonly statusText: string
  /** The body when it is a JSON object. */
  readonly json: Readonly<Record<string, unknown>> | undefined
}

/**
 * The answers of an issuer's discovery locations: the OpenID Connect one, and after its 404 the
 * RFC 8414 one. The document is the last answer's JSON when its status is 200. Fails with a
 * TokenFailure only without an answer (unreachable, timeout, a success above the cap); before
 * sending, an issuer of another scheme or with a user or a password fails with a RangeError (one
 * that is no URL at all with the URL parser's TypeError).
 */
export async function discover(
  issuer: string,
  platform: Platform,
  limits?: TokenLimits,
): Promise<readonly DiscoveryAnswer[]> {
  const get = async (url: string): Promise<DiscoveryAnswer> => {
    const answer = await exchange(
      { method: "GET", url, headers: { Accept: "application/json" } },
      platform,
      limits,
    )
    return { url, status: answer.status, statusText: answer.statusText, json: answer.json }
  }
  const [oidc, rfc8414] = discoveryUrls(issuer)
  const first = await get(oidc)
  return first.status === 404 ? [first, await get(rfc8414)] : [first]
}

/** Why an OAuth URL cannot be used: no URL, user info, plain http off loopback, a fragment. */
export type OAuthUrlProblem = "not-a-url" | "credentials" | "insecure" | "fragment"

/**
 * Whether `url` (trimmed) can serve as an authorization server's endpoint, or why not: https, or
 * http on a host `isLoopback` accepts; no user info; no fragment.
 */
export function oauthUrlProblem(
  url: string,
  isLoopback: (host: string) => boolean,
): OAuthUrlProblem | undefined {
  const trimmed = url.trim()
  if (!URL.canParse(trimmed)) return "not-a-url"
  const parsed = new URL(trimmed)
  if (parsed.username !== "" || parsed.password !== "") return "credentials"
  const plain = parsed.protocol === "http:" && isLoopback(parsed.hostname)
  if (parsed.protocol !== "https:" && !plain) return "insecure"
  return parsed.hash !== "" || trimmed.endsWith("#") ? "fragment" : undefined
}

/** The authorization server as a client uses it. */
export interface ServerMetadata {
  readonly issuer: string
  readonly authorizationEndpoint: string
  readonly tokenEndpoint: string
  /** RFC 7009; none when the document names none or one that cannot be used. */
  readonly revocationEndpoint?: string
  /**
   * OpenID Connect RP-Initiated Logout 1.0 (`endSessionUrl`); none when the document names none
   * or one that cannot be used.
   */
  readonly endSessionEndpoint?: string
  /** RFC 9207: every callback carries `iss`. */
  readonly issParameterRequired: boolean
  /** How a confidential client authenticates: `basic` unless the server only offers `post`. */
  readonly clientAuth: "basic" | "post"
}

type EndpointKey = "authorization_endpoint" | "token_endpoint"

/** Why a discovery document is not the expected issuer's. */
type IssuerProblem =
  | { readonly problem: "no-issuer" }
  /** `named` is the document's issuer as sent, unchecked. */
  | { readonly problem: "other-issuer"; readonly named: string }

/** Why a discovery document cannot be used, in the order it is checked. */
export type MetadataProblem =
  | IssuerProblem
  | { readonly problem: "no-endpoint"; readonly key: EndpointKey }
  | {
      readonly problem: "endpoint-url"
      readonly key: EndpointKey
      readonly url: string
      readonly urlProblem: OAuthUrlProblem
    }
  /**
   * `url` is the endpoint as sent: on a loopback host while the issuer is on none, so a remote
   * document would send the client's secret, a code or a token to the client's own machine.
   */
  | { readonly problem: "endpoint-loopback"; readonly key: EndpointKey; readonly url: string }
  | { readonly problem: "no-pkce" }
  /** A confidential client, and the server offers neither client_secret_basic nor _post. */
  | { readonly problem: "client-auth" }

export interface MetadataNeeds {
  /** The client has a secret: the server must accept it by basic or post. */
  readonly confidential: boolean
  /** Which hosts may be reached over plain http: the caller's one rule of loopback. */
  readonly isLoopback: (host: string) => boolean
}

type Document = Readonly<Record<string, unknown>>

function issuerProblem(document: Document, issuer: string): IssuerProblem | undefined {
  const named = document.issuer
  if (typeof named !== "string") return { problem: "no-issuer" }
  return named === issuer ? undefined : { problem: "other-issuer", named }
}

/** Whether `url` is a URL on a host `isLoopback` accepts. */
function onLoopback(url: string, isLoopback: MetadataNeeds["isLoopback"]): boolean {
  return URL.canParse(url) && isLoopback(new URL(url).hostname)
}

/** Whether `url` (trimmed, usable) lies on a loopback host while `issuer` does not. */
function strayLoopback(
  url: string,
  issuer: string,
  isLoopback: MetadataNeeds["isLoopback"],
): boolean {
  return onLoopback(url, isLoopback) && !onLoopback(issuer, isLoopback)
}

function endpointOf(document: Document, key: EndpointKey, issuer: string, needs: MetadataNeeds) {
  const value = document[key]
  if (typeof value !== "string" || value.trim() === "") {
    return { problem: "no-endpoint", key } as const
  }
  const urlProblem = oauthUrlProblem(value, needs.isLoopback)
  if (urlProblem !== undefined) {
    return { problem: "endpoint-url", key, url: value, urlProblem } as const
  }
  const endpoint = value.trim()
  if (strayLoopback(endpoint, issuer, needs.isLoopback)) {
    return { problem: "endpoint-loopback", key, url: value } as const
  }
  return endpoint
}

/**
 * An endpoint a client can do without: none when the document names none or one that cannot be
 * used.
 */
function optionalEndpointOf(
  document: Document,
  key: "revocation_endpoint" | "end_session_endpoint",
  issuer: string,
  needs: MetadataNeeds,
): string | undefined {
  const value = document[key]
  if (typeof value !== "string" || oauthUrlProblem(value, needs.isLoopback) !== undefined) {
    return undefined
  }
  const endpoint = value.trim()
  return strayLoopback(endpoint, issuer, needs.isLoopback) ? undefined : endpoint
}

/** The endpoints a client can do without that the document names usable ones for. */
function optionalEndpoints(
  document: Document,
  issuer: string,
  needs: MetadataNeeds,
): Pick<ServerMetadata, "revocationEndpoint" | "endSessionEndpoint"> {
  const revocationEndpoint = optionalEndpointOf(document, "revocation_endpoint", issuer, needs)
  const endSessionEndpoint = optionalEndpointOf(document, "end_session_endpoint", issuer, needs)
  return {
    ...(revocationEndpoint === undefined ? {} : { revocationEndpoint }),
    ...(endSessionEndpoint === undefined ? {} : { endSessionEndpoint }),
  }
}

function clientAuthOf(document: Document, needs: MetadataNeeds): "basic" | "post" | undefined {
  const methods = document.token_endpoint_auth_methods_supported
  if (!Array.isArray(methods) || methods.includes("client_secret_basic")) return "basic"
  if (methods.includes("client_secret_post")) return "post"
  return needs.confidential ? undefined : "basic"
}

/** The PKCE methods allow S256, or the document lists none. */
function offersS256(document: Document): boolean {
  const methods = document.code_challenge_methods_supported
  return !Array.isArray(methods) || methods.includes("S256")
}

/** The metadata of a discovery document for `issuer`, or the first reason it cannot be used. */
export function serverMetadata(
  document: Document,
  issuer: string,
  needs: MetadataNeeds,
): ServerMetadata | MetadataProblem {
  const refused = issuerProblem(document, issuer)
  if (refused !== undefined) return refused
  const authorizationEndpoint = endpointOf(document, "authorization_endpoint", issuer, needs)
  if (typeof authorizationEndpoint !== "string") return authorizationEndpoint
  const tokenEndpoint = endpointOf(document, "token_endpoint", issuer, needs)
  if (typeof tokenEndpoint !== "string") return tokenEndpoint
  if (!offersS256(document)) return { problem: "no-pkce" }
  const clientAuth = clientAuthOf(document, needs)
  if (clientAuth === undefined) return { problem: "client-auth" }
  return {
    issuer,
    authorizationEndpoint,
    tokenEndpoint,
    ...optionalEndpoints(document, issuer, needs),
    issParameterRequired: document.authorization_response_iss_parameter_supported === true,
    clientAuth,
  }
}

/** What a resource server needs of the authorization server to verify its access tokens. */
export interface KeyMetadata {
  readonly issuer: string
  /** The URL of the key set the tokens are signed with (`jwks_uri`), trimmed. */
  readonly jwksUri: string
  /**
   * The issuer the access tokens carry where it differs from the issuer (`access_token_issuer`,
   * MS-OIDCE; ADFS), as named: it is only compared with a token's, never fetched, so plain http
   * is kept. None when the document names none or one that is no absolute http or https URL.
   */
  readonly accessTokenIssuer?: string
}

/** Why a discovery document gives no key set, in the order it is checked. */
export type KeyMetadataProblem =
  | IssuerProblem
  | { readonly problem: "no-jwks" }
  /** `url` is the document's `jwks_uri` as sent, which `oauthUrlProblem` refuses. */
  | {
      readonly problem: "jwks-insecure"
      readonly url: string
      readonly urlProblem: OAuthUrlProblem
    }
  /**
   * `url` is the document's `jwks_uri` as sent: on a loopback host while the issuer is on none,
   * so a remote document would point the verifier at the server's own machine.
   */
  | { readonly problem: "jwks-loopback"; readonly url: string }

type KeyNeeds = Pick<MetadataNeeds, "isLoopback">

function jwksOf(document: Document, issuer: string, needs: KeyNeeds) {
  const value = document.jwks_uri
  if (typeof value !== "string" || value.trim() === "") return { problem: "no-jwks" } as const
  const urlProblem = oauthUrlProblem(value, needs.isLoopback)
  if (urlProblem !== undefined) return { problem: "jwks-insecure", url: value, urlProblem } as const
  const jwksUri = value.trim()
  if (strayLoopback(jwksUri, issuer, needs.isLoopback)) {
    return { problem: "jwks-loopback", url: value } as const
  }
  return jwksUri
}

function accessTokenIssuerOf(document: Document): string | undefined {
  const value = document.access_token_issuer
  if (typeof value !== "string" || !URL.canParse(value)) return undefined
  const { protocol } = new URL(value)
  return protocol === "https:" || protocol === "http:" ? value : undefined
}

/**
 * The key metadata of a discovery document for `issuer`, or the first reason it gives none. It
 * asks nothing a sign-in needs (endpoints, PKCE, a client authentication), so a server whose
 * clients sign in by a method this package does not offer still has its tokens verified.
 */
export function keyMetadata(
  document: Document,
  issuer: string,
  needs: KeyNeeds,
): KeyMetadata | KeyMetadataProblem {
  const refused = issuerProblem(document, issuer)
  if (refused !== undefined) return refused
  const jwksUri = jwksOf(document, issuer, needs)
  if (typeof jwksUri !== "string") return jwksUri
  const accessTokenIssuer = accessTokenIssuerOf(document)
  return { issuer, jwksUri, ...(accessTokenIssuer === undefined ? {} : { accessTokenIssuer }) }
}
