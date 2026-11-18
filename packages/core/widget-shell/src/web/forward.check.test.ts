import { describe, expect, it } from "vitest"
import {
  bearersOf,
  checkedEvery,
  CLEARED,
  jsonOf,
  SECOND,
  setup,
  SIGNED_OUT,
  T0,
  tokens,
  type TokenAnswer,
} from "./call.test-support.js"
import { SESSION_COOKIE } from "./cookies.js"
import { RENEWAL_KEPT_MS, SILENT_KEPT_MS } from "./refresh.js"

/**
 * The session's check at the provider on a page's call (`MCP_WEB_SESSION_CHECK_MINUTES`): a
 * refresh long before the token is due by its expiry, the session ended by the provider's second
 * refusal or by a refresh token that expired, kept through an outage for one more interval.
 */

const MINUTE = 60 * SECOND
/** A check every five minutes over tokens of an hour, which their expiry renews only at 59 minutes. */
const CHECK = 5 * MINUTE
const HOUR_LONG = { expiresAt: T0 + 60 * MINUTE }
const REFRESH_REFUSAL = { status: 400, body: { error: "invalid_grant" } }

/** A call route over a session of tokens of an hour, checked every five minutes, called at `at`. */
const checked = (at: number, provider: TokenAnswer[]) =>
  setup({ context: checkedEvery(5), session: HOUR_LONG, at, provider })

describe("POST /app/api/call: the session's check at the provider", () => {
  it("renews a token the check finds due, long before it expires", async () => {
    const { call, requests, idp } = await checked(T0 + CHECK - 1, [
      tokens("access-2", { expires_in: 3600 }),
    ])
    expect((await call()).headers.getSetCookie()).toEqual([])
    idp.clock.now = T0 + CHECK
    const response = await call()
    expect(response.status).toBe(200)
    expect(response.headers.getSetCookie()[0]).toMatch(new RegExp(`^${SESSION_COOKIE}=`))
    expect(bearersOf(requests)).toEqual(["Bearer access-1", "Bearer access-2"])
    expect(idp.forms).toHaveLength(1)
  })

  it("ends the session within the check's interval and 30 s once the provider refuses it", async () => {
    // Revoked at the provider: the check's first refusal may be a race, its second is final.
    const { call, idp } = await checked(T0 + CHECK, [REFRESH_REFUSAL, REFRESH_REFUSAL])
    expect((await call()).status).toBe(200)
    idp.clock.now = T0 + CHECK + RENEWAL_KEPT_MS
    const response = await call()
    expect(await jsonOf(response)).toEqual({ status: 401, body: SIGNED_OUT })
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it("ends the session at a due check once its refresh token expired, without asking the provider", async () => {
    const session = { ...HOUR_LONG, refreshExpiresAt: T0 + MINUTE }
    const { call, requests, idp, logged } = await setup({
      context: checkedEvery(5),
      session,
      at: T0 + CHECK - 1,
      provider: [tokens("access-2")],
    })
    expect((await call()).status).toBe(200)
    idp.clock.now = T0 + CHECK
    const response = await call()
    expect(await jsonOf(response)).toEqual({ status: 401, body: SIGNED_OUT })
    expect(response.headers.getSetCookie()).toEqual(CLEARED)
    expect(bearersOf(requests)).toEqual(["Bearer access-1"])
    expect(idp.forms).toEqual([])
    expect(logged).toEqual([
      "Web session ended: the session's check is due and its refresh token expired.",
    ])
  })

  it("sends the token through a silent check for one more interval, then answers 503 and keeps the session", async () => {
    const { call, requests, idp } = await checked(T0 + 2 * CHECK - 1, [
      "unreachable",
      tokens("access-2"),
    ])
    expect((await call()).status).toBe(200)
    idp.clock.now = T0 + 2 * CHECK
    const silent = await call()
    expect(await jsonOf(silent)).toEqual({
      status: 503,
      body: {
        message:
          "The identity provider does not answer, so the session's token was not renewed. Try again shortly.",
      },
    })
    expect(silent.headers.getSetCookie()).toEqual([])
    // Once the provider answers, the session goes on.
    idp.clock.now = T0 + 2 * CHECK + SILENT_KEPT_MS
    expect((await call()).status).toBe(200)
    expect(bearersOf(requests)).toEqual(["Bearer access-1", "Bearer access-2"])
  })
})
