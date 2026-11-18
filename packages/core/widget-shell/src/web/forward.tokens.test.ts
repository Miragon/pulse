import { afterEach, describe, expect, it, vi } from "vitest"
import {
  bearersOf,
  callContext,
  CLEARED,
  CSRF,
  DUE,
  EXPIRED,
  GATE_REFUSAL,
  jsonOf,
  mcpTarget,
  pageCall,
  result,
  RESULT,
  ROWS,
  scriptedProvider,
  SECOND,
  sessionCookie,
  sessionTokens,
  setup,
  SIGNED_OUT,
  T0,
  tokens,
  type McpReply,
  type TokenAnswer,
} from "./call.test-support.js"
import { endedCookie, SESSION_COOKIE } from "./cookies.js"
import { callRoute, type McpTarget } from "./forward.js"
import { REFRESH_TIMEOUT_MS, RENEWAL_KEPT_MS, SILENT_KEPT_MS } from "./refresh.js"
import type { WebSession } from "./session.js"
import { FLAGS } from "./sign-in.test-support.js"

/**
 * The session's token on a page's call: renewed where it is due, after the gate's 401 where a new
 * one may help, sealed back into the cookie with the session's own expiry, or the session ended.
 */

const REFRESH_REFUSAL = { status: 400, body: { error: "invalid_grant" } }
const PROVIDER_SILENT = {
  status: 503,
  body: {
    message:
      "The identity provider does not answer, so the session's token was not renewed. Try again shortly.",
  },
}

afterEach(() => {
  vi.useRealTimers()
})

/** The `Cookie` header a browser sends back for the session cookie an answer set. */
function cookieOf(response: Response): string {
  const [first] = response.headers.getSetCookie()
  return first.split(";")[0]
}

/** The session the answer's cookies hold, opened with the route's own seal. */
async function cookieSession(ctx: Awaited<ReturnType<typeof setup>>["ctx"], response: Response) {
  const [first] = response.headers.getSetCookie()
  const sealed = first.slice(`${SESSION_COOKIE}=`.length).split(";")[0]
  const opened = await ctx.sealer.open(SESSION_COOKIE, sealed, ctx.platform.now())
  return opened.ok ? { session: opened.value as WebSession, expiresAt: opened.expiresAt } : opened
}

describe("POST /app/api/call: the session's token", () => {
  it("renews a due token first, forwards the new one and seals it into the cookie", async () => {
    const { call, requests, ctx } = await setup({
      at: DUE,
      provider: [tokens("access-2", { refresh_token: "refresh-2" })],
    })
    const response = await call()
    expect(response.status).toBe(200)
    expect(bearersOf(requests)).toEqual(["Bearer access-2"])
    const setCookies = response.headers.getSetCookie()
    // The session's expiry, never extended by a refresh: eight hours from T0.
    expect(setCookies[0]).toContain(`; Max-Age=${8 * 3600 - 270}; ${FLAGS}`)
    expect(await cookieSession(ctx, response)).toEqual({
      session: {
        id: "session-1",
        csrf: CSRF,
        name: "Alice Adams",
        tokens: {
          accessToken: "access-2",
          receivedAt: DUE,
          expiresAt: DUE + 300 * SECOND,
          refreshToken: "refresh-2",
        },
      },
      expiresAt: T0 + 8 * 3_600_000,
    })
  })

  it("sends a token that still holds at the provider's first refusal of the refresh token", async () => {
    // A call beside it on another replica may have spent the refresh token: the session goes on.
    const { call, requests } = await setup({
      at: DUE,
      provider: [REFRESH_REFUSAL],
      mcp: [result(RESULT)],
    })
    const response = await call()
    expect(await jsonOf(response)).toEqual({ status: 200, body: { result: RESULT } })
    expect(bearersOf(requests)).toEqual(["Bearer access-1"])
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it("ends the session at the provider's second refusal of the same tokens, leaving the cookies", async () => {
    const { call, requests, idp, logged } = await setup({
      at: DUE,
      provider: [REFRESH_REFUSAL, REFRESH_REFUSAL],
    })
    expect((await call()).status).toBe(200)
    // The first refusal is kept 30 s: the calls meanwhile send the token, then the provider is asked again.
    idp.clock.now = DUE + RENEWAL_KEPT_MS - 1
    expect((await call()).status).toBe(200)
    idp.clock.now = DUE + RENEWAL_KEPT_MS
    const response = await call()
    expect(await jsonOf(response)).toEqual({ status: 401, body: SIGNED_OUT })
    expect(response.headers.getSetCookie()).toEqual([])
    expect([requests.length, idp.forms.length]).toEqual([2, 2])
    expect(logged.at(-1)).toBe(
      "Web session ended: the identity provider refused the refresh token.",
    )
  })

  it("ends the session once the token expired and the provider refuses the refresh token, leaving the cookies", async () => {
    // A call beside it may just have renewed them: a cookie whose session is gone fails again.
    const { call, requests, logged } = await setup({ at: EXPIRED, provider: [REFRESH_REFUSAL] })
    const response = await call()
    expect(await jsonOf(response)).toEqual({ status: 401, body: SIGNED_OUT })
    expect(response.headers.getSetCookie()).toEqual([])
    expect(requests).toEqual([])
    expect(logged.at(-1)).toBe(
      "Web session ended: the identity provider refused the refresh token.",
    )
  })

  it("sends a token that still holds while the provider does not answer", async () => {
    const { call, requests } = await setup({ at: DUE, provider: [{ status: 503, body: {} }] })
    const response = await call()
    expect(response.status).toBe(200)
    expect(bearersOf(requests)).toEqual(["Bearer access-1"])
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it("answers 503 for an expired token while the provider does not answer", async () => {
    const { call, requests } = await setup({ at: EXPIRED, provider: ["unreachable"] })
    const response = await call()
    expect(await jsonOf(response)).toEqual(PROVIDER_SILENT)
    expect(response.headers.getSetCookie()).toEqual([])
    expect(requests).toEqual([])
  })

  it("waits 10 s at most for a provider that hangs, and sends at once within the next 5 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const { call, requests, idp } = await setup({ at: DUE, provider: ["hangs"] })
    const first = call()
    // The refresh is sent once the cookie opened, which takes real time.
    while (idp.forms.length === 0) await new Promise((resolve) => setImmediate(resolve))
    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS)
    expect((await first).status).toBe(200)
    idp.clock.now = DUE + SILENT_KEPT_MS - 1
    expect((await call()).status).toBe(200)
    expect(bearersOf(requests)).toEqual(["Bearer access-1", "Bearer access-1"])
    expect(idp.forms).toHaveLength(1)
  })

  it("ends the session with an expired token nothing renews", async () => {
    const { call, requests, logged } = await setup({
      at: EXPIRED,
      session: { refreshToken: undefined },
    })
    const response = await call()
    expect(await jsonOf(response)).toEqual({ status: 401, body: SIGNED_OUT })
    expect(response.headers.getSetCookie()).toEqual(CLEARED)
    expect(requests).toEqual([])
    expect(logged).toEqual([
      "Web session ended: the session's token expired and nothing renews it.",
    ])
  })

  it("forwards without a refresh a token another replica received by a clock that runs ahead", async () => {
    // Sealed at T0 on a replica five minutes ahead; this replica's clock reads T0 − 5 min.
    const { call, requests, idp } = await setup({ at: T0 - 300 * SECOND })
    expect((await call()).status).toBe(200)
    expect(bearersOf(requests)).toEqual(["Bearer access-1"])
    expect(idp.forms).toEqual([])
  })

  it("keeps the renewed tokens in the cookie when /mcp then fails", async () => {
    const { call } = await setup({
      at: DUE,
      provider: [tokens("access-2")],
      mcp: [{ status: 500, body: "" }],
    })
    const response = await call()
    expect(response.status).toBe(502)
    expect(response.headers.getSetCookie()[0]).toMatch(new RegExp(`^${SESSION_COOKIE}=`))
  })

  it("renews a renewed token again once it is due, where the provider kept the refresh token", async () => {
    // Tokens of 5 s are due at once; the provider's answers carry no refresh token (RFC 6749 §6),
    // so the session keeps its own, and the renewed cookie brings it again 6 s later.
    const idp = scriptedProvider(
      tokens("access-2", { expires_in: 5 }),
      tokens("access-3", { expires_in: 5 }),
    )
    const { ctx } = callContext(idp.platform)
    const { target, requests } = mcpTarget()
    const route = callRoute(ctx, target)
    idp.clock.now = DUE
    const first = await route(pageCall(await sessionCookie(ctx, sessionTokens(T0)), ROWS))
    idp.clock.now = DUE + 6 * SECOND
    const second = await route(pageCall(cookieOf(first), ROWS))
    expect([first.status, second.status]).toEqual([200, 200])
    expect(bearersOf(requests)).toEqual(["Bearer access-2", "Bearer access-3"])
    expect(idp.forms.map((form) => form.get("refresh_token"))).toEqual(["refresh-1", "refresh-1"])
  })

  it("ends the session when the renewed one no longer fits its cookies", async () => {
    const { call, logged } = await setup({
      at: DUE,
      provider: [tokens("a".repeat(12_000))],
    })
    const response = await call()
    expect(await jsonOf(response)).toEqual({ status: 401, body: SIGNED_OUT })
    expect(response.headers.getSetCookie()).toEqual(CLEARED)
    expect(logged).toEqual(["Web session ended: the renewed session does not fit its cookies."])
  })
})

/** The gate's 401 body for a token past its exp. */
const EXPIRED_BODY = '{"error":"invalid_token","error_description":"Token has expired"}'

describe("POST /app/api/call: after the gate refused the token", () => {
  it("ends the session without a refresh for a young token, which a new one would not mend", async () => {
    const { call, requests, idp, logged } = await setup({
      at: T0 + 29 * SECOND,
      mcp: [GATE_REFUSAL],
    })
    const response = await call()
    expect(await jsonOf(response)).toEqual({ status: 401, body: SIGNED_OUT })
    expect(response.headers.getSetCookie()).toEqual(CLEARED)
    expect([requests.length, idp.forms.length]).toEqual([1, 0])
    expect(logged).toEqual(["Web session ended: the gate refused the session's token."])
  })

  // The gate's reason (its 401's error_description) goes into the line; a body without one, or
  // that is no JSON object, names none.
  it.each<[string, string, string]>([
    ["its reason", EXPIRED_BODY, " (Token has expired)"],
    ["no reason that is text", '{"error":"invalid_token","error_description":7}', ""],
    ["a body that is no object", "null", ""],
    ["a body that is no JSON", "Unauthorized", ""],
  ])("names in its log line %s of the refusal", async (_case, body, reason) => {
    const { call, logged } = await setup({
      at: T0 + 29 * SECOND,
      mcp: [{ ...GATE_REFUSAL, body }],
    })
    expect(await jsonOf(await call())).toEqual({ status: 401, body: SIGNED_OUT })
    expect(logged).toEqual([`Web session ended: the gate refused the session's token${reason}.`])
  })

  it("renews an older token once and calls again with the new one", async () => {
    const { call, requests } = await setup({
      at: T0 + 30 * SECOND,
      provider: [tokens("access-2")],
      mcp: [GATE_REFUSAL, result(RESULT)],
    })
    const response = await call()
    expect(await jsonOf(response)).toEqual({ status: 200, body: { result: RESULT } })
    expect(bearersOf(requests)).toEqual(["Bearer access-1", "Bearer access-2"])
    expect(response.headers.getSetCookie()[0]).toMatch(new RegExp(`^${SESSION_COOKIE}=`))
  })

  it("ends the session when the gate refuses the renewed token too", async () => {
    const { call, requests, logged } = await setup({
      at: T0 + 30 * SECOND,
      provider: [tokens("access-2")],
      mcp: [GATE_REFUSAL, GATE_REFUSAL],
    })
    const response = await call()
    expect(await jsonOf(response)).toEqual({ status: 401, body: SIGNED_OUT })
    expect(requests).toHaveLength(2)
    expect(logged).toEqual(["Web session ended: the gate refused the renewed token."])
  })

  it("names the gate's reason for refusing the renewed token", async () => {
    const { call, logged } = await setup({
      at: T0 + 30 * SECOND,
      provider: [tokens("access-2")],
      mcp: [GATE_REFUSAL, { ...GATE_REFUSAL, body: EXPIRED_BODY }],
    })
    expect(await jsonOf(await call())).toEqual({ status: 401, body: SIGNED_OUT })
    expect(logged).toEqual([
      "Web session ended: the gate refused the renewed token (Token has expired).",
    ])
  })

  it("ends the session when the provider refuses the refresh token then, leaving the cookies", async () => {
    const { call, requests, logged } = await setup({
      at: T0 + 30 * SECOND,
      provider: [REFRESH_REFUSAL],
      mcp: [GATE_REFUSAL],
    })
    const response = await call()
    expect(await jsonOf(response)).toEqual({ status: 401, body: SIGNED_OUT })
    expect(response.headers.getSetCookie()).toEqual([])
    expect(requests).toHaveLength(1)
    expect(logged.at(-1)).toBe(
      "Web session ended: the identity provider refused the refresh token.",
    )
  })

  it("answers 503 when the provider does not answer then", async () => {
    const { call, requests } = await setup({
      at: T0 + 30 * SECOND,
      provider: [{ status: 502, body: {} }],
      mcp: [GATE_REFUSAL],
    })
    const response = await call()
    expect(response.status).toBe(503)
    expect(response.headers.getSetCookie()).toEqual([])
    expect(requests).toHaveLength(1)
  })
})

describe("POST /app/api/call: a page that leaves", () => {
  it("cancels what it sent to /mcp, the call again after the gate's refusal too", async () => {
    const idp = scriptedProvider(tokens("access-2"))
    const { ctx } = callContext(idp.platform)
    const cookie = await sessionCookie(ctx, sessionTokens(T0))
    idp.clock.now = T0 + 30 * SECOND
    const { target, requests } = mcpTarget(GATE_REFUSAL, result(RESULT))
    const page = new AbortController()
    const response = await callRoute(ctx, target)(pageCall(cookie, ROWS, {}, page.signal))
    expect(response.status).toBe(200)
    expect(requests.map(({ signal }) => signal.aborted)).toEqual([false, false])
    page.abort()
    expect(requests.map(({ signal }) => signal.aborted)).toEqual([true, true])
  })

  /** The call route over a `/mcp` that answers `reply` after the page left. */
  async function leftDuring(reply: McpReply) {
    const { ctx } = callContext(scriptedProvider().platform)
    const cookie = await sessionCookie(ctx, sessionTokens(T0))
    const page = new AbortController()
    const { target } = mcpTarget(reply)
    const leaving: McpTarget = {
      ...target,
      fetch: (request) => {
        page.abort()
        return target.fetch(request)
      },
    }
    return callRoute(ctx, leaving)(pageCall(cookie, ROWS, {}, page.signal))
  }

  it("answers 499 when the page left before /mcp answered a result, never /mcp's 502", async () => {
    const response = await leftDuring({ contentType: "text/event-stream", body: "" })
    expect(await jsonOf(response)).toEqual({
      status: 499,
      body: { message: "Client closed request: the page left before the tool answered." },
    })
  })

  it("answers a result /mcp gave before the page left, as any other", async () => {
    const response = await leftDuring(result(RESULT))
    expect(await jsonOf(response)).toEqual({ status: 200, body: { result: RESULT } })
  })
})

describe("POST /app/api/call: a session signed out", () => {
  const SESSION_END = T0 + 8 * 3_600_000

  /** A call whose session this replica records as signed out while `/mcp` runs it. */
  async function signedOutDuring(at: number, provider: TokenAnswer[] = []) {
    const idp = scriptedProvider(...provider)
    const { ctx, logged } = callContext(idp.platform)
    const cookie = await sessionCookie(ctx, sessionTokens(T0))
    idp.clock.now = at
    const { target, requests } = mcpTarget(result(RESULT))
    const signingOut: McpTarget = {
      ...target,
      fetch: (request) => {
        ctx.ended.end("session-1", SESSION_END, idp.clock.now)
        return target.fetch(request)
      },
    }
    const response = await callRoute(ctx, signingOut)(pageCall(cookie, ROWS))
    return { response, logged, requests }
  }

  it("while its call ran gets no result and sets no renewed cookie, so the sign-out's cookies stay", async () => {
    const { response, logged, requests } = await signedOutDuring(DUE, [
      tokens("access-2", { refresh_token: "refresh-2" }),
    ])
    expect(await jsonOf(response)).toEqual({ status: 401, body: SIGNED_OUT })
    expect(response.headers.getSetCookie()).toEqual([])
    expect(bearersOf(requests)).toEqual(["Bearer access-2"])
    expect(logged).toEqual([
      "Web call answered after its session was signed out: no result, no cookie.",
    ])
  })

  it("while its call ran gets no result where nothing was renewed either", async () => {
    const { response } = await signedOutDuring(T0)
    expect(await jsonOf(response)).toEqual({ status: 401, body: SIGNED_OUT })
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it("before its call is refused before anything is forwarded, its cookies cleared", async () => {
    const { call, requests, ctx, logged, idp } = await setup({ at: DUE })
    ctx.ended.end("session-1", SESSION_END, T0)
    const response = await call()
    expect(await jsonOf(response)).toEqual({ status: 401, body: SIGNED_OUT })
    expect(response.headers.getSetCookie()).toEqual(CLEARED)
    expect([requests.length, idp.forms.length]).toEqual([0, 0])
    expect(logged).toEqual(["Web session refused: it was signed out."])
  })

  it("is refused by the ended cookie the browser holds for it, on a replica that never knew it", async () => {
    const { ctx } = await setup()
    const { target, requests } = mcpTarget()
    const route = callRoute(ctx, target)
    const session = await sessionCookie(ctx, sessionTokens(T0))
    const ended = (await endedCookie(ctx.sealer, "session-1", SESSION_END, T0)).split(";")[0]
    const other = (await endedCookie(ctx.sealer, "session-0", SESSION_END, T0)).split(";")[0]
    // The ended cookie of another session, which the browser signed out before, refuses nothing.
    expect((await route(pageCall(`${session}; ${other}`, ROWS))).status).toBe(200)
    const response = await route(pageCall(`${session}; ${ended}`, ROWS))
    expect(await jsonOf(response)).toEqual({ status: 401, body: SIGNED_OUT })
    expect(response.headers.getSetCookie()).toEqual(CLEARED)
    expect(requests).toHaveLength(1)
  })
})
