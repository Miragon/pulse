/**
 * GET /app/api/session: what a page shows and sends of its session: the name of who signed in,
 * the CSRF token its requests that change something carry, and when the session ends. Without a
 * session that opens, 401 `signed_out`. A session whose access token expired answers as a page's
 * call would go out (forward.ts): renewed first through the replica's renewals, which the calls
 * share, its cookie sealed again; else 401 `signed_out`, its cookies cleared where nothing renews
 * the token and left where the provider refused the refresh token (a call beside it may just have
 * renewed them), or 503 while the provider does not answer. So a page never shows a session no
 * call of it would go through, after a reload either. A token that has not expired needs no
 * renewal for that: the page's first call renews it where it is due. No token ever leaves the
 * server.
 */
import { isExpired } from "@miragon/pulse-http/oauth"
import type { WebSessionInfo } from "../protocol/web.js"
import { json, type WebContext } from "./context.js"
import { cookiesWith, signedOutMeanwhile, tokensToSend, unsentAnswer } from "./forward.js"
import { renewalSource, type RenewalSource } from "./refresh.js"
import { requestSession } from "./session.js"

export function sessionRoute(
  ctx: WebContext,
  renew: RenewalSource = renewalSource(ctx),
): (request: Request) => Promise<Response> {
  return async (request) => {
    const opened = await requestSession(ctx, request)
    if (opened instanceof Response) return opened
    const { name, csrf, tokens } = opened.session
    const live = isExpired(tokens, ctx.platform.now())
      ? await tokensToSend(ctx, renew, tokens)
      : tokens
    const signedOut = signedOutMeanwhile(ctx, opened, "Web session read")
    if (signedOut !== undefined) return signedOut
    if ("kind" in live) return unsentAnswer(ctx, live)
    const setCookies = await cookiesWith(ctx, opened, live, request)
    if (setCookies instanceof Response) return setCookies
    const info: WebSessionInfo = { name, csrf, expiresAt: opened.expiresAt }
    return json(200, info, setCookies)
  }
}
