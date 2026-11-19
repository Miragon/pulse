/**
 * GET /app/api/session: what a page shows and sends of its session: the name of who signed in,
 * the CSRF token its requests that change something carry, and when the session ends. Without a
 * session that opens, 401 `signed_out`. The session's tokens go through what a page's call would
 * send (forward.ts): a token due by its expiry or by the session's check is renewed first through
 * the replica's renewals, which the calls share, its cookie sealed again; a session that ended
 * answers 401 `signed_out`, its cookies cleared where nothing renews the token and left where the
 * provider refused the refresh token (a call beside it may just have renewed them), and a provider
 * that does not answer 503 once the token no longer goes out. So a page never shows a session no
 * call of it would go through, after a reload either, and a reload shows a session the provider
 * ended within the check's interval. No token ever leaves the server.
 */
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
    const live = await tokensToSend(ctx, renew, tokens)
    const signedOut = signedOutMeanwhile(ctx, opened, "Web session read")
    if (signedOut !== undefined) return signedOut
    if ("kind" in live) return unsentAnswer(ctx, live)
    const setCookies = await cookiesWith(ctx, opened, live, request)
    if (setCookies instanceof Response) return setCookies
    const info: WebSessionInfo = { name, csrf, expiresAt: opened.expiresAt }
    return json(200, info, setCookies)
  }
}
