/**
 * The authorization server's metadata: OpenID Connect discovery with the RFC 8414 location as
 * fallback, and the document's check. It must name exactly the expected issuer (RFC 8414 §3.3),
 * offer PKCE with S256 when it lists methods, and a client authentication the client can do; its
 * endpoints must be https, or http on a loopback host (the caller's rule, so every surface keeps
 * one definition of loopback).
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
  /** RFC 9207: every callback carries `iss`. */
  readonly issParameterRequired: boolean
  /** How a confidential client authenticates: `basic` unless the server only offers `post`. */
  readonly clientAuth: "basic" | "post"
}

type EndpointKey = "authorization_endpoint" | "token_endpoint"

/** Why a discovery document cannot be used, in the order it is checked. */
export type MetadataProblem =
  | { readonly problem: "no-issuer" }
  /** `named` is the document's issuer as sent, unchecked. */
  | { readonly problem: "other-issuer"; readonly named: string }
  | { readonly problem: "no-endpoint"; readonly key: EndpointKey }
  | {
      readonly problem: "endpoint-url"
      readonly key: EndpointKey
      readonly url: string
      readonly urlProblem: OAuthUrlProblem
    }
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

function endpointOf(document: Document, key: EndpointKey, needs: MetadataNeeds) {
  const value = document[key]
  if (typeof value !== "string" || value.trim() === "") {
    return { problem: "no-endpoint", key } as const
  }
  const urlProblem = oauthUrlProblem(value, needs.isLoopback)
  if (urlProblem === undefined) return value.trim()
  return { problem: "endpoint-url", key, url: value, urlProblem } as const
}

function revocationOf(document: Document, needs: MetadataNeeds): string | undefined {
  const value = document.revocation_endpoint
  if (typeof value !== "string") return undefined
  return oauthUrlProblem(value, needs.isLoopback) === undefined ? value.trim() : undefined
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
  const named = document.issuer
  if (typeof named !== "string") return { problem: "no-issuer" }
  if (named !== issuer) return { problem: "other-issuer", named }
  const authorizationEndpoint = endpointOf(document, "authorization_endpoint", needs)
  if (typeof authorizationEndpoint !== "string") return authorizationEndpoint
  const tokenEndpoint = endpointOf(document, "token_endpoint", needs)
  if (typeof tokenEndpoint !== "string") return tokenEndpoint
  if (!offersS256(document)) return { problem: "no-pkce" }
  const clientAuth = clientAuthOf(document, needs)
  if (clientAuth === undefined) return { problem: "client-auth" }
  const revocationEndpoint = revocationOf(document, needs)
  return {
    issuer,
    authorizationEndpoint,
    tokenEndpoint,
    ...(revocationEndpoint === undefined ? {} : { revocationEndpoint }),
    issParameterRequired: document.authorization_response_iss_parameter_supported === true,
    clientAuth,
  }
}
