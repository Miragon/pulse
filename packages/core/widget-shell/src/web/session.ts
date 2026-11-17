/**
 * The web app's session as its cookie carries it, sealed for the session cookie (seal.ts) in its
 * chunks (cookies.ts): the sign-in's tokens without the ID token, the name the page shows, the
 * session's own id and its CSRF secret, until the absolute expiry of the sign-in. Nothing of it is
 * kept on the server, so every replica built with the same keys serves it; a replica keeps only the
 * ids of the sessions signed out there (ended.ts), and the browser that signed out the id of its
 * own (the ended cookie), so a cookie of a signed-out session opens no session again.
 */
import { randomBytes } from "node:crypto"
import type { TokenRecord } from "@miragon/pulse-http/oauth"
import type { WebRefusal } from "../protocol/web.js"
import { json, SIGNED_OUT, type WebContext } from "./context.js"
import {
  clearedSession,
  endedId,
  parseCookies,
  SESSION_COOKIE,
  sessionValue,
  type CookieJar,
} from "./cookies.js"
import { csrfRefusal } from "./csrf.js"
import type { Opened } from "./seal.js"

/** The tokens a session keeps: what renewing them takes, never the ID token or the scope. */
export type SessionTokens = Pick<
  TokenRecord,
  "accessToken" | "receivedAt" | "expiresAt" | "refreshToken" | "refreshExpiresAt"
>

export interface WebSession {
  /** New with every sign-in, so a session planted before it never survives it. */
  readonly id: string
  /** The secret a page's request that changes something carries (csrf.ts), new with every sign-in. */
  readonly csrf: string
  /** Who signed in, as the page shows it. */
  readonly name: string
  readonly tokens: SessionTokens
}

/** A new session's id: 16 random bytes in base64url. */
export const newSessionId = (): string => randomBytes(16).toString("base64url")

/** The tokens of a token answer a session keeps. */
export function sessionTokensOf(record: TokenRecord): SessionTokens {
  const { accessToken, receivedAt, expiresAt, refreshToken, refreshExpiresAt } = record
  return { accessToken, receivedAt, expiresAt, refreshToken, refreshExpiresAt }
}

/** A session that opened, with the expiry it was sealed with. */
export interface OpenedSession extends Opened {
  readonly session: WebSession
}

/**
 * A session's end as a route answers it: 401 `signed_out`, its cookies cleared unless `clears` is
 * false, and a log line that says why.
 */
export function sessionEnded(ctx: WebContext, why: string, clears = true): Response {
  ctx.log(`Web session ended: ${why}.`)
  return json(401, SIGNED_OUT, clears ? clearedSession() : [])
}

/** Whether the session `id` was signed out: at this replica, or in the browser that sent `jar`. */
async function signedOutBefore(
  ctx: WebContext,
  id: string,
  jar: CookieJar,
  now: number,
): Promise<boolean> {
  return ctx.ended.has(id, now) || (await endedId(ctx.sealer, jar, now)) === id
}

/**
 * The request's session, or the 401 a route answers without one: `signed_out`, and the session's
 * cookies cleared when the browser sent one that no longer opens (expired, or sealed with a key
 * this server has dropped) or whose session was signed out (at this replica, or as the request's
 * ended cookie names it). A request that sent none gets no cookie back.
 */
export async function requestSession(
  ctx: WebContext,
  request: Request,
): Promise<OpenedSession | Response> {
  const jar = parseCookies(request.headers.get("cookie"))
  const sealed = sessionValue(jar)
  if (sealed === undefined) return json(401, SIGNED_OUT)
  const now = ctx.platform.now()
  const opened = await ctx.sealer.open(SESSION_COOKIE, sealed, now)
  if (!opened.ok) return json(401, SIGNED_OUT, clearedSession())
  // Only the callback seals a value for the session cookie's name, so an opened one is a session.
  const session = opened.value as WebSession
  if (!(await signedOutBefore(ctx, session.id, jar, now))) return { ...opened, session }
  ctx.log("Web session refused: it was signed out.")
  return json(401, SIGNED_OUT, clearedSession())
}

const CROSS_SITE: WebRefusal = { message: "Refused: the request did not come from the app's page." }

/**
 * The session of a request that changes something, which only the app's own page may send: the
 * session opens (else 401, as {@link requestSession}), and the request passes the CSRF check
 * (csrf.ts), else 403 and a log line that names the `action` and why, never the token.
 */
export async function pageSession(
  ctx: WebContext,
  request: Request,
  action: string,
): Promise<OpenedSession | Response> {
  const opened = await requestSession(ctx, request)
  if (opened instanceof Response) return opened
  const secret = opened.session.csrf
  const refusal = csrfRefusal(request.headers, { secret, origin: ctx.settings.origin })
  if (refusal === undefined) return opened
  ctx.log(`${action} refused: ${refusal}.`)
  return json(403, CROSS_SITE)
}
