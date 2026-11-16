/**
 * The web app's session as its cookie carries it, sealed for the session cookie (seal.ts) in its
 * chunks (cookies.ts): the sign-in's tokens without the ID token, the name the page shows, the
 * session's own id and its CSRF secret, until the absolute expiry of the sign-in. Nothing of it is
 * kept on the server, so every replica built with the same keys serves it.
 */
import { randomBytes } from "node:crypto"
import type { TokenRecord } from "@miragon/pulse-http/oauth"
import { json, SIGNED_OUT, type WebContext } from "./context.js"
import { clearedSession, parseCookies, SESSION_COOKIE, sessionValue } from "./cookies.js"
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
 * The request's session, or the 401 a route answers without one: `signed_out`, and the session's
 * cookies cleared when the browser sent one that no longer opens (expired, or sealed with a key
 * this server has dropped). A request that sent none gets no cookie back.
 */
export async function requestSession(
  ctx: WebContext,
  request: Request,
): Promise<OpenedSession | Response> {
  const sealed = sessionValue(parseCookies(request.headers.get("cookie")))
  if (sealed === undefined) return json(401, SIGNED_OUT)
  const opened = await ctx.sealer.open(SESSION_COOKIE, sealed, ctx.platform.now())
  if (!opened.ok) return json(401, SIGNED_OUT, clearedSession())
  // Only the callback seals a value for the session cookie's name, so an opened one is a session.
  return { ...opened, session: opened.value as WebSession }
}
