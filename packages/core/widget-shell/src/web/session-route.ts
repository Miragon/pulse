/**
 * GET /app/api/session: what a page shows and sends of its session: the name of who signed in,
 * the CSRF token its requests that change something carry, and when the session ends. Without a
 * session that opens, 401 `signed_out`. No token ever leaves the server.
 */
import type { WebSessionInfo } from "../protocol/web.js"
import { json, type WebContext } from "./context.js"
import { requestSession } from "./session.js"

export function sessionRoute(ctx: WebContext): (request: Request) => Promise<Response> {
  return async (request) => {
    const opened = await requestSession(ctx, request)
    if (opened instanceof Response) return opened
    const { name, csrf } = opened.session
    const info: WebSessionInfo = { name, csrf, expiresAt: opened.expiresAt }
    return json(200, info)
  }
}
