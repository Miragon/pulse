import { describe, expect, it } from "vitest"
import {
  bearersOf,
  CLEARED,
  CSRF,
  DUE,
  EXPIRED,
  GATE_REFUSAL,
  jsonOf,
  result,
  RESULT,
  SECOND,
  setup,
  SIGNED_OUT,
  T0,
  tokens,
} from "./call.test-support.js"
import { SESSION_COOKIE } from "./cookies.js"
import type { WebSession } from "./session.js"
import { FLAGS } from "./sign-in.test-support.js"

/**
 * The session's token on a page's call: renewed where it is due, after the gate's 401 where a new
 * one may help, sealed back into the cookie with the session's own expiry, or the session ended.
 */

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

  it("ends the session when the provider refuses the refresh token, and forwards nothing", async () => {
    const { call, requests, logged } = await setup({
      at: DUE,
      provider: [{ status: 400, body: { error: "invalid_grant" } }],
    })
    const response = await call()
    expect(await jsonOf(response)).toEqual({ status: 401, body: SIGNED_OUT })
    expect(response.headers.getSetCookie()).toEqual(CLEARED)
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
    expect(await jsonOf(response)).toEqual({
      status: 503,
      body: {
        message:
          "The identity provider does not answer, so the session's token was not renewed. Try again shortly.",
      },
    })
    expect(response.headers.getSetCookie()).toEqual([])
    expect(requests).toEqual([])
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

  it("ends the session when the provider refuses the refresh token then", async () => {
    const { call, requests, logged } = await setup({
      at: T0 + 30 * SECOND,
      provider: [{ status: 400, body: { error: "invalid_grant" } }],
      mcp: [GATE_REFUSAL],
    })
    expect(await jsonOf(await call())).toEqual({ status: 401, body: SIGNED_OUT })
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
