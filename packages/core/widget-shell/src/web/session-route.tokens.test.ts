import type { Platform } from "@miragon/pulse-http"
import { describe, expect, it } from "vitest"
import {
  callContext,
  checkedEvery,
  CLEARED,
  CSRF,
  DUE,
  EXPIRED,
  jsonOf,
  mcpTarget,
  pageCall,
  ROWS,
  scriptedProvider,
  SECOND,
  sessionCookie,
  sessionTokens,
  SIGNED_OUT,
  T0,
  tokens,
  type TokenAnswer,
} from "./call.test-support.js"
import { SESSION_COOKIE } from "./cookies.js"
import { callRoute } from "./forward.js"
import { renewalSource, RENEWAL_KEPT_MS } from "./refresh.js"
import type { WebSession } from "./session.js"
import { sessionRoute } from "./session-route.js"
import { FLAGS, ORIGIN } from "./sign-in.test-support.js"

/**
 * The session route's answer to a session whose access token is due: what a page's call would go
 * out with, so a page reloaded after the session ended shows no session (forward.ts's rules).
 */

const SESSION_END = T0 + 8 * 3_600_000
const REFRESH_REFUSAL = { status: 400, body: { error: "invalid_grant" } }
const INFO = { name: "Alice Adams", csrf: CSRF, expiresAt: SESSION_END }

/** The session route's request as a page sends it, with the session's cookie. */
const sessionRead = (cookie: string) =>
  new Request(`${ORIGIN}/app/api/session`, { headers: { cookie } })

/** The session route on a scripted provider, its session's tokens received at T0, read at `at`. */
async function read(at: number, provider: TokenAnswer[] = []) {
  const idp = scriptedProvider(...provider)
  const { ctx, logged } = callContext(idp.platform)
  const cookie = await sessionCookie(ctx, sessionTokens(T0))
  idp.clock.now = at
  const response = await sessionRoute(ctx)(sessionRead(cookie))
  return { response, logged, idp, ctx }
}

/** A check every five minutes over tokens of an hour, and the session route read at `at`. */
async function checkedRead(at: number, provider: TokenAnswer[]) {
  const idp = scriptedProvider(...provider)
  const { ctx } = callContext(idp.platform, checkedEvery(5))
  const cookie = await sessionCookie(ctx, sessionTokens(T0, { expiresAt: T0 + 3_600_000 }))
  idp.clock.now = at
  const route = sessionRoute(ctx)
  return { idp, route, read: () => route(sessionRead(cookie)) }
}

const CHECK = 300 * SECOND

describe("GET /app/api/session: the session's token", () => {
  it("answers a token that is not due as it is: no refresh, no cookie", async () => {
    const { response, idp } = await read(DUE - 1)
    expect(await jsonOf(response)).toEqual({ status: 200, body: INFO })
    expect(response.headers.getSetCookie()).toEqual([])
    expect(idp.forms).toEqual([])
  })

  it("renews a token the session's check finds due, as a call would", async () => {
    const { read: again, idp } = await checkedRead(T0 + CHECK, [tokens("access-2")])
    const response = await again()
    expect(await jsonOf(response)).toEqual({ status: 200, body: INFO })
    expect(response.headers.getSetCookie()[0]).toMatch(new RegExp(`^${SESSION_COOKIE}=`))
    expect(idp.forms).toHaveLength(1)
  })

  it("answers 401 at the provider's second refusal of a due check, leaving the cookies", async () => {
    const { read: again, idp } = await checkedRead(T0 + CHECK, [REFRESH_REFUSAL, REFRESH_REFUSAL])
    // The first may be a race with another replica's renewal: the token still holds.
    expect((await again()).status).toBe(200)
    idp.clock.now = T0 + CHECK + RENEWAL_KEPT_MS
    const response = await again()
    expect(await jsonOf(response)).toEqual({ status: 401, body: SIGNED_OUT })
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it("renews an expired token first and seals the new one into the cookie, its expiry kept", async () => {
    const { response, idp, ctx } = await read(EXPIRED, [
      tokens("access-2", { refresh_token: "refresh-2" }),
    ])
    expect(await jsonOf(response)).toEqual({ status: 200, body: INFO })
    expect(idp.forms.map((form) => form.get("refresh_token"))).toEqual(["refresh-1"])
    const [setCookie, ...rest] = response.headers.getSetCookie()
    expect(rest).toEqual([])
    expect(setCookie).toContain(`; Max-Age=${8 * 3600 - 300}; ${FLAGS}`)
    const sealed = setCookie.slice(`${SESSION_COOKIE}=`.length).split(";")[0]
    const opened = await ctx.sealer.open(SESSION_COOKIE, sealed, EXPIRED)
    expect(opened.ok && (opened.value as WebSession).tokens).toEqual({
      accessToken: "access-2",
      receivedAt: EXPIRED,
      expiresAt: EXPIRED + 300 * SECOND,
      refreshToken: "refresh-2",
    })
  })

  it("answers 401 once the provider refuses the refresh token, leaving the cookies", async () => {
    // A call beside it may just have renewed them: a cookie whose session is gone fails again.
    const { response, logged } = await read(EXPIRED, [REFRESH_REFUSAL])
    expect(await jsonOf(response)).toEqual({ status: 401, body: SIGNED_OUT })
    expect(response.headers.getSetCookie()).toEqual([])
    expect(logged.at(-1)).toBe(
      "Web session ended: the identity provider refused the refresh token.",
    )
  })

  it("answers 503 while the provider does not answer, and sets no cookie", async () => {
    const { response } = await read(EXPIRED, ["unreachable"])
    expect(await jsonOf(response)).toEqual({
      status: 503,
      body: {
        message:
          "The identity provider does not answer, so the session's token was not renewed. Try again shortly.",
      },
    })
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it("ends the session when the renewed one no longer fits its cookies", async () => {
    const { response, logged } = await read(EXPIRED, [tokens("a".repeat(12_000))])
    expect(await jsonOf(response)).toEqual({ status: 401, body: SIGNED_OUT })
    expect(response.headers.getSetCookie()).toEqual(CLEARED)
    expect(logged).toEqual(["Web session ended: the renewed session does not fit its cookies."])
  })

  it("answers 401 with no cookie when the session was signed out while its token was renewed", async () => {
    const idp = scriptedProvider(tokens("access-2", { refresh_token: "refresh-2" }))
    const signingOut: Platform = {
      now: () => idp.clock.now,
      fetch: (input, init) => {
        ctx.ended.end("session-1", SESSION_END, idp.clock.now)
        return idp.platform.fetch(input, init)
      },
    }
    const { ctx, logged } = callContext(signingOut)
    const cookie = await sessionCookie(ctx, sessionTokens(T0))
    idp.clock.now = EXPIRED
    const response = await sessionRoute(ctx)(sessionRead(cookie))
    expect(await jsonOf(response)).toEqual({ status: 401, body: SIGNED_OUT })
    expect(response.headers.getSetCookie()).toEqual([])
    expect(logged).toEqual([
      "Web session read answered after its session was signed out: no result, no cookie.",
    ])
  })

  it("shares the replica's renewal with the calls: a read and a call of one cookie renew once", async () => {
    const idp = scriptedProvider(tokens("access-2"))
    const { ctx } = callContext(idp.platform)
    const cookie = await sessionCookie(ctx, sessionTokens(T0))
    idp.clock.now = EXPIRED
    const renew = renewalSource(ctx)
    const { target } = mcpTarget()
    const answers = await Promise.all([
      sessionRoute(ctx, renew)(sessionRead(cookie)),
      callRoute(ctx, target, renew)(pageCall(cookie, ROWS)),
    ])
    expect(answers.map(({ status }) => status)).toEqual([200, 200])
    expect(idp.forms).toHaveLength(1)
  })
})
