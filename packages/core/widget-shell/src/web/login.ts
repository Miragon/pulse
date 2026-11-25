/**
 * GET /app/auth/login: starts a sign-in at the server's own identity provider. The page to return
 * to follows the return path's rule (`/app` when the request names none it may return to); the
 * state, the PKCE verifier and that page go into the sealed login cookie for ten minutes; the
 * browser goes on (302) to the provider's authorization endpoint with the code flow, PKCE S256,
 * the state, the provider's web scopes, and the gate's resource (RFC 8707), or the one the web
 * client names in its place, unless it names none; the gate's also as `audience` for a provider
 * that names a token's API by it. A provider that does not answer sends the browser to the
 * signed-out page (`unavailable`).
 */
import { authorizationUrl, createPkce } from "@miragon/pulse-http/oauth"
import { WEB_QUERY } from "../protocol/web.js"
import { callbackUri, redirect, signedOutPage, type WebContext } from "./context.js"
import { loginCookie } from "./cookies.js"
import { returnTarget } from "./return-path.js"

export function loginRoute(ctx: WebContext): (request: Request) => Promise<Response> {
  const { settings, client, resource } = ctx
  return async (request) => {
    const returnTo = returnTarget(new URL(request.url).searchParams.get(WEB_QUERY.returnTo))
    const metadata = await ctx.metadata()
    if (metadata === undefined) return redirect(303, signedOutPage("unavailable"))
    const { state, verifier, challenge } = await createPkce()
    const cookie = await loginCookie(ctx.sealer, { state, verifier, returnTo }, ctx.platform.now())
    const location = authorizationUrl(metadata.authorizationEndpoint, {
      clientId: settings.clientId,
      redirectUri: callbackUri(settings),
      scopes: client.scopes,
      ...(client.audience === "resource" ? { audience: resource } : {}),
      ...(client.resource === false ? {} : { resources: [client.resource ?? resource] }),
      challenge,
      state,
    })
    return redirect(302, location, [cookie])
  }
}
