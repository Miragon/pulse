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
  PROTOCOL_VERSION_META_KEY,
  verifyBearerToken,
  type AuthInfo,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server"
import type { OAuthProvider } from "./oauth-providers.js"
import {
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
        throw invalidToken("Token resource does not match the protected resource")
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
  const options = {
    verifier: oauthVerifier(provider, resource),
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resource),
    requiredScopes: [...(provider.requiredScopes ?? [])],
  }
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

/**
 * What `oauthMetadataResponse` serves, validated once at boot: an issuer the discovery document
 * cannot advertise (HTTP off loopback, a query, a fragment) fails the boot instead of every
 * discovery request. The SDK admits plain HTTP for `localhost` and `127.0.0.1` only; the providers
 * admit every loopback name, so those pass explicitly.
 */
export function oauthDiscovery(provider: OAuthProvider, resource: URL) {
  let issuer: URL
  try {
    issuer = new URL(provider.oauthMetadata.issuer)
  } catch {
    throw new Error(`OAuth issuer "${provider.oauthMetadata.issuer}" is not an absolute URL`)
  }
  const options = {
    oauthMetadata: provider.oauthMetadata,
    resourceServerUrl: resource,
    dangerouslyAllowInsecureIssuerUrl: issuer.protocol === "http:" && isLocalhost(issuer),
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
