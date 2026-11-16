/**
 * POST /app/auth/logout: ends the session. It changes something, so it takes only a request of
 * the app's own page (csrf.ts: Sec-Fetch-Site, Origin and the session's CSRF token). The refresh
 * token is revoked where the provider offers revocation (RFC 7009), a failure only logged, every
 * session and login cookie is cleared, and the answer names where the browser goes next: the
 * provider's end of its session (OpenID Connect RP-Initiated Logout, with the client and the
 * signed-out page `<MCP_URL>/app/signed-out` to return to), else the signed-out page itself. The
 * session keeps no ID token, so the provider may ask the user to confirm.
 */
import { endSessionUrl, revokeToken, type ServerMetadata } from "@miragon/pulse-http/oauth"
import { WEB_PATHS, type WebRefusal, type WebSignOut } from "../protocol/web.js"
import { json, type WebContext } from "./context.js"
import { clearedLogin, clearedSession } from "./cookies.js"
import { csrfRefusal } from "./csrf.js"
import { requestSession } from "./session.js"

const CROSS_SITE: WebRefusal = { message: "Refused: the request did not come from the app's page." }

async function revoke(
  ctx: WebContext,
  metadata: ServerMetadata | undefined,
  refreshToken: string | undefined,
): Promise<void> {
  if (metadata?.revocationEndpoint === undefined || refreshToken === undefined) return
  const { clientId, clientSecret } = ctx.settings
  const endpoint = {
    url: metadata.revocationEndpoint,
    clientId,
    clientSecret,
    clientAuth: metadata.clientAuth,
  }
  try {
    await revokeToken(endpoint, { value: refreshToken, hint: "refresh_token" }, ctx.platform)
  } catch (error) {
    ctx.log(`Web sign-out: the refresh token was not revoked (${(error as Error).message}).`)
  }
}

/** Where the browser goes after the sign-out. */
function nextOf(ctx: WebContext, metadata: ServerMetadata | undefined): string {
  const endpoint = metadata?.endSessionEndpoint
  if (endpoint === undefined) return WEB_PATHS.signedOut
  return endSessionUrl(endpoint, {
    clientId: ctx.settings.clientId,
    postLogoutRedirectUri: `${ctx.settings.origin}${WEB_PATHS.signedOut}`,
  })
}

export function logoutRoute(ctx: WebContext): (request: Request) => Promise<Response> {
  return async (request) => {
    const opened = await requestSession(ctx, request)
    if (opened instanceof Response) return opened
    const { csrf, tokens } = opened.session
    const refusal = csrfRefusal(request.headers, { secret: csrf, origin: ctx.settings.origin })
    if (refusal !== undefined) {
      ctx.log(`Web sign-out refused: ${refusal}.`)
      return json(403, CROSS_SITE)
    }
    const metadata = await ctx.metadata()
    await revoke(ctx, metadata, tokens.refreshToken)
    const answer: WebSignOut = { location: nextOf(ctx, metadata) }
    return json(200, answer, [...clearedSession(), clearedLogin()])
  }
}
