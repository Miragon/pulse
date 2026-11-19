/**
 * What stands between `/mcp` and a provider: the bearer gate (the SDK's `verifyBearerToken` and
 * challenges, plus 503 when the provider cannot verify now), the discovery documents validated at
 * boot, the canonical resource every token is bound to, and ChatGPT's tool-result challenge.
 */
import {
  bearerAuthChallengeResponse,
  buildOAuthProtectedResourceMetadata,
  getOAuthProtectedResourceMetadataUrl,
  OAuthError,
  OAuthErrorCode,
  oauthMetadataResponse,
  PROTOCOL_VERSION_META_KEY,
  verifyBearerToken,
  type AuthInfo,
  type AuthMetadataOptions,
  type OAuthMetadata,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server"
import type { OAuthProvider, OAuthServerMetadata } from "./oauth-providers.js"
import {
  audienceRefusal,
  invalidToken,
  isAllowedHttpUrl,
  isLocalhost,
  isRecord,
  nonBlank,
  trimPath,
} from "./oauth-shared.js"

/** A string, so the comparison with `OAuthError.code` (a string) shares its type. */
const TEMPORARILY_UNAVAILABLE: string = OAuthErrorCode.TemporarilyUnavailable

const MORE_THAN_ONE_CREDENTIAL = "The Authorization header must carry exactly one Bearer token"

/** Binds a provider's verifier to this server and maps the identity under `extra`. */
function oauthVerifier(provider: OAuthProvider, resource: URL): OAuthTokenVerifier {
  const expected = trimPath(new URL(resource))
  const verifier = provider.createTokenVerifier(new URL(expected))
  return {
    async verifyAccessToken(token) {
      const authInfo = await verifier.verifyAccessToken(token)
      const bound = authInfo.resource
      if (!(bound instanceof URL) || trimPath(new URL(bound)).href !== expected.href) {
        throw audienceRefusal("Token resource does not match the protected resource")
      }
      let mapped: ReturnType<OAuthProvider["mapAuthInfo"]>
      try {
        mapped = provider.mapAuthInfo(authInfo)
      } catch (error) {
        throw invalidToken("Token identity mapping failed", error)
      }
      return { ...authInfo, extra: { ...authInfo.extra, ...mapped } }
    },
  }
}

/** The verified caller, or the refusal to send back. */
export type OAuthGate = (request: Request) => Promise<AuthInfo | Response>

/** What the gate's challenge names: the resource's metadata URL and the scopes it requires. */
function challengeOptions(provider: OAuthProvider, resource: URL) {
  return {
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resource),
    requiredScopes: [...(provider.requiredScopes ?? [])],
  }
}

/** What the gate checks a bearer token by: the bound verifier, the metadata URL, the scopes. */
function gateOptions(provider: OAuthProvider, resource: URL) {
  return { verifier: oauthVerifier(provider, resource), ...challengeOptions(provider, resource) }
}

/** What {@link gateTokenCheck} makes of one access token: its caller, or a thrown refusal. */
export type GateTokenCheck = (token: string) => Promise<AuthInfo>

/**
 * The gate's own check of one access token, outside a request: its caller, else the `OAuthError`
 * the gate refuses it with (an audience refusal, `isAudienceRefusal`, for a token bound to another
 * resource; `temporarily_unavailable` while the key set does not load). The web sign-in keeps no
 * token `/mcp` would refuse.
 */
export function gateTokenCheck(provider: OAuthProvider, resource: URL): GateTokenCheck {
  const options = gateOptions(provider, resource)
  return (token) => verifyBearerToken(`Bearer ${token}`, options)
}

/**
 * The gate's answer to a request it takes no credential from, outside the gate: 401
 * `invalid_token` with `description`, its `WWW-Authenticate: Bearer` challenge naming the
 * resource's metadata (and the required scopes), as the gate answers a request without a bearer
 * token, so a client discovers the authorization server from it the same way; never stored.
 */
export function gateChallenge(
  provider: OAuthProvider,
  resource: URL,
): (description: string) => Response {
  const options = challengeOptions(provider, resource)
  return (description) => {
    const response = bearerAuthChallengeResponse(invalidToken(description), options)
    response.headers.set("cache-control", "no-store")
    return response
  }
}

/**
 * The bearer gate in front of `/mcp`: the SDK's `verifyBearerToken` and its challenge answers
 * (401 `invalid_token`, 403 `insufficient_scope`), plus 503 `temporarily_unavailable` when the
 * provider's verifier says it cannot verify now (the key set did not load). Anything else a
 * verifier throws is a bug: `onUnexpected` gets it, the client a plain 500.
 */
export function oauthGate(
  provider: OAuthProvider,
  resource: URL,
  onUnexpected: (error: unknown) => void,
): OAuthGate {
  const options = gateOptions(provider, resource)
  return async (request) => {
    const authorization = request.headers.get("authorization") || undefined
    try {
      // One credential, the one verified: a comma list (or a repeated header the runtime joined)
      // would carry a second credential nobody checked to whatever reads the header behind the gate.
      if (authorization?.includes(",")) throw invalidToken(MORE_THAN_ONE_CREDENTIAL)
      return await verifyBearerToken(authorization, options)
    } catch (error) {
      if (error instanceof OAuthError && error.code === TEMPORARILY_UNAVAILABLE) {
        return Response.json(error.toResponseObject(), {
          status: 503,
          headers: { "cache-control": "no-store" },
        })
      }
      if (!(error instanceof OAuthError)) onUnexpected(error)
      return bearerAuthChallengeResponse(error, options)
    }
  }
}

/** The scope a client asks to keep its grant offline, which no resource advertises (MCP). */
const OFFLINE_ACCESS = "offline_access"

/** What the protected resource metadata advertises: the required scopes as a client asks them. */
function advertisedScopes(provider: OAuthProvider): string[] {
  const scopes = provider.scopesSupported ?? provider.requiredScopes ?? []
  return scopes.filter((scope) => scope !== OFFLINE_ACCESS)
}

/** Whether the provider's metadata is RFC 8414's, which names its endpoints, or its issuer alone. */
const namesEndpoints = (metadata: OAuthServerMetadata): metadata is OAuthMetadata =>
  typeof metadata.authorization_endpoint === "string" && typeof metadata.token_endpoint === "string"

/** The discovery documents of the server: the SDK's options, and whether it serves the AS copy. */
export interface OAuthDiscovery extends AuthMetadataOptions {
  readonly servesServerMetadata: boolean
}

/**
 * What {@link oauthDiscoveryResponse} serves, validated once at boot: an issuer the discovery
 * document cannot advertise (HTTP off loopback, a query, a fragment) fails the boot instead of
 * every discovery request. The SDK admits plain HTTP for `localhost` and `127.0.0.1` only; the
 * providers admit every loopback name, so those pass explicitly. The protected resource metadata
 * names the required scopes in `scopes_supported` where the provider requires any.
 */
export function oauthDiscovery(provider: OAuthProvider, resource: URL): OAuthDiscovery {
  const metadata = provider.oauthMetadata
  let issuer: URL
  try {
    issuer = new URL(metadata.issuer)
  } catch {
    throw new Error(`OAuth issuer "${metadata.issuer}" is not an absolute URL`)
  }
  const scopes = advertisedScopes(provider)
  const options: OAuthDiscovery = {
    // The SDK reads the issuer alone from it, unless it serves the copy, which only metadata that
    // names its endpoints gets (servesServerMetadata).
    oauthMetadata: metadata as OAuthMetadata,
    resourceServerUrl: resource,
    dangerouslyAllowInsecureIssuerUrl: issuer.protocol === "http:" && isLocalhost(issuer),
    ...(scopes.length > 0 && { scopesSupported: scopes }),
    servesServerMetadata: namesEndpoints(metadata),
  }
  try {
    buildOAuthProtectedResourceMetadata(options)
  } catch (error) {
    throw new Error(
      `OAuth issuer "${issuer.href}" cannot be advertised in discovery: ${(error as Error).message}`,
      { cause: error },
    )
  }
  return options
}

/** Where clients older than MCP 2025-06-18 read RFC 8414's metadata at the resource's origin. */
const SERVER_METADATA_PATH = "/.well-known/oauth-authorization-server"

/**
 * The discovery answer to `request` (the SDK's documents, its preflight and 405 answers), or
 * `undefined` for a path that holds none: the protected resource metadata always, the copy of the
 * authorization server's metadata only for a provider whose metadata names its endpoints.
 */
export function oauthDiscoveryResponse(
  request: Request,
  discovery: OAuthDiscovery,
): Response | undefined {
  const { pathname } = new URL(request.url)
  // The SDK takes the path with one trailing slash too.
  const copy = pathname === SERVER_METADATA_PATH || pathname === `${SERVER_METADATA_PATH}/`
  if (copy && !discovery.servesServerMetadata) return undefined
  return oauthMetadataResponse(request, discovery)
}

function originOnly(value: string): string {
  const url = new URL(value)
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("MCP_URL must be an absolute origin without a path")
  }
  return url.origin
}

/** ChatGPT reads a refused `tools/call` as a tool result carrying the challenge, not as a 401. */
export async function toolResultChallenge(
  request: Request,
  refusal: Response,
): Promise<Response | undefined> {
  if (!/chatgpt|openai/i.test(request.headers.get("user-agent") ?? "")) return undefined
  const message: unknown = await request
    .clone()
    .json()
    .catch(() => undefined)
  if (!isRecord(message) || message.method !== "tools/call" || message.id === undefined) {
    return undefined
  }
  const body: unknown = await refusal
    .clone()
    .json()
    .catch(() => undefined)
  const header = refusal.headers.get("www-authenticate")
  const params = isRecord(message.params) ? message.params : undefined
  const meta = isRecord(params?._meta) ? params._meta : undefined
  return Response.json({
    jsonrpc: "2.0",
    id: message.id,
    result: {
      ...(meta?.[PROTOCOL_VERSION_META_KEY] !== undefined && { resultType: "complete" }),
      content: [
        {
          type: "text",
          text:
            (isRecord(body) && nonBlank(body, "error_description")) ||
            "Authentication is required.",
        },
      ],
      isError: true,
      _meta: { "mcp/www_authenticate": header === null ? [] : [header] },
    },
  })
}

/** The canonical resource: exactly the base path, on HTTPS or loopback HTTP. */
export function resolveOAuthResource(
  provider: OAuthProvider,
  mcpUrl: string | undefined,
  basePath: string,
): URL {
  const raw =
    provider.resource ?? (mcpUrl?.trim() ? originOnly(mcpUrl.trim()) + basePath : undefined)
  if (raw === undefined) {
    throw new Error("OAuth needs an explicit resource or MCP_URL.")
  }
  const url = new URL(raw)
  if (!isAllowedHttpUrl(url))
    throw new Error("OAuth resource must use HTTPS, or HTTP for localhost")
  if (trimPath(url).pathname !== basePath) {
    throw new Error(`OAuth resource path must exactly match basePath (${basePath})`)
  }
  return url
}
