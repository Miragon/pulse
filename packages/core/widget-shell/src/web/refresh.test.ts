import { afterEach, describe, expect, it, vi } from "vitest"
import { TokenFailure } from "@miragon/pulse-http/oauth"
import {
  callContext,
  checkedEvery,
  scriptedProvider,
  SECOND,
  sessionTokens,
  SETTINGS,
  T0,
  tokens,
  type TokenAnswer,
} from "./call.test-support.js"
import {
  checkMsOf,
  CLOCK_AHEAD_MS,
  holdsWhileSilent,
  isCheckDue,
  REFRESH_TIMEOUT_MS,
  RENEWAL_KEPT_MS,
  renewableAfterRefusal,
  renewalSource,
  seenAt,
  SILENT_KEPT_MS,
  tokenStep,
  type RenewableTokens,
} from "./refresh.js"
import { RESOURCE } from "./sign-in.test-support.js"

/** Tokens of five minutes, renewed 30 s before they expire (a tenth of their lifetime). */
const RECEIVED = sessionTokens(T0) as RenewableTokens
const DUE_AT = T0 + 270 * SECOND
const EXPIRES_AT = T0 + 300 * SECOND

const MINUTE = 60 * SECOND
/** A check every five minutes, and tokens of an hour, renewed a minute before they expire. */
const CHECK = 5 * MINUTE
const HOUR_LONG = sessionTokens(T0, { expiresAt: T0 + 60 * MINUTE }) as RenewableTokens

const REFUSAL: TokenAnswer = { status: 400, body: { error: "invalid_grant" } }
const FIRST = { kind: "refused", final: false }
const FINAL = { kind: "refused", final: true }
const EXPIRED_END = { kind: "end", why: "the session's token expired and nothing renews it" }
const UNCHECKED_END = {
  kind: "end",
  why: "the session's check is due and its refresh token expired",
}

afterEach(() => {
  vi.useRealTimers()
})

describe("checkMsOf: the check's interval", () => {
  it("is none without MCP_WEB_SESSION_CHECK_MINUTES, else its minutes", () => {
    expect(checkMsOf(SETTINGS)).toBeUndefined()
    expect(checkMsOf({ ...SETTINGS, sessionCheckMinutes: 5 })).toBe(CHECK)
  })
})

describe("isCheckDue: the session's check at the provider", () => {
  it("is never due without a check", () => {
    expect(isCheckDue(HOUR_LONG, T0 + 59 * MINUTE, undefined)).toBe(false)
    expect(isCheckDue(HOUR_LONG, T0 - 10 * MINUTE, undefined)).toBe(false)
  })

  it("is due once the tokens are its interval old", () => {
    expect(isCheckDue(HOUR_LONG, T0 + CHECK - 1, CHECK)).toBe(false)
    expect(isCheckDue(HOUR_LONG, T0 + CHECK, CHECK)).toBe(true)
  })

  it("is due at once for a receipt more than a minute after this replica's clock", () => {
    // Another replica whose clock runs ahead received them: it must not postpone the check here.
    expect(CLOCK_AHEAD_MS).toBe(MINUTE)
    expect(isCheckDue(HOUR_LONG, T0 - 59 * SECOND, CHECK)).toBe(false)
    expect(isCheckDue(HOUR_LONG, T0 - 60 * SECOND, CHECK)).toBe(false)
    expect(isCheckDue(HOUR_LONG, T0 - 61 * SECOND, CHECK)).toBe(true)
  })
})

describe("holdsWhileSilent: a token while the provider does not answer", () => {
  it("goes out until it expires without a check", () => {
    expect(holdsWhileSilent(HOUR_LONG, T0 + 60 * MINUTE - 1, undefined)).toBe(true)
    expect(holdsWhileSilent(HOUR_LONG, T0 + 60 * MINUTE, undefined)).toBe(false)
  })

  it("goes out for two of the check's intervals after its receipt at most, never once expired", () => {
    expect(holdsWhileSilent(HOUR_LONG, T0 + 2 * CHECK - 1, CHECK)).toBe(true)
    expect(holdsWhileSilent(HOUR_LONG, T0 + 2 * CHECK, CHECK)).toBe(false)
    expect(holdsWhileSilent(RECEIVED, EXPIRES_AT - 1, 60 * MINUTE)).toBe(true)
    expect(holdsWhileSilent(RECEIVED, EXPIRES_AT, 60 * MINUTE)).toBe(false)
  })
})

describe("seenAt: the tokens by this replica's clock", () => {
  it("counts a receipt after now as received now", () => {
    expect(seenAt(RECEIVED, T0 - 120 * SECOND)).toEqual({
      ...RECEIVED,
      receivedAt: T0 - 120 * SECOND,
    })
  })

  it("keeps the tokens as they are otherwise", () => {
    expect(seenAt(RECEIVED, T0)).toBe(RECEIVED)
    expect(seenAt(RECEIVED, T0 + SECOND)).toBe(RECEIVED)
  })
})

describe("tokenStep: what a call does with the session's token", () => {
  it("sends a token that is not due", () => {
    expect(tokenStep(RECEIVED, DUE_AT - 1)).toEqual({ kind: "send" })
  })

  it("renews a due token that a refresh token can renew", () => {
    expect(tokenStep(RECEIVED, DUE_AT)).toEqual({ kind: "renew", tokens: RECEIVED })
  })

  it("sends a due token nothing renews until it expires, then ends the session", () => {
    const plain = sessionTokens(T0, { refreshToken: undefined })
    expect(tokenStep(plain, DUE_AT)).toEqual({ kind: "send" })
    expect(tokenStep(plain, EXPIRES_AT)).toEqual(EXPIRED_END)
    // Without a check, a refresh token that expired first ends nothing before the access token.
    const spent = sessionTokens(T0, { refreshExpiresAt: DUE_AT })
    expect(tokenStep(spent, DUE_AT)).toEqual({ kind: "send" })
    expect(tokenStep(spent, EXPIRES_AT)).toEqual(EXPIRED_END)
  })

  it("never renews a token another replica received by a clock that runs ahead", () => {
    // Received at T0 by a clock five minutes ahead of this one: without the clamp the policy
    // would find it due on every call, a clock that stepped back.
    expect(tokenStep(RECEIVED, T0 - 300 * SECOND)).toEqual({ kind: "send" })
  })

  it("renews a token the check finds due long before it expires", () => {
    expect(tokenStep(HOUR_LONG, T0 + CHECK - 1, CHECK)).toEqual({ kind: "send" })
    expect(tokenStep(HOUR_LONG, T0 + CHECK, CHECK)).toEqual({ kind: "renew", tokens: HOUR_LONG })
    // Due by its expiry, it renews before the check would.
    expect(tokenStep(RECEIVED, DUE_AT, 60 * MINUTE)).toEqual({ kind: "renew", tokens: RECEIVED })
  })

  it("renews by the check a token received more than a minute ahead, as received now", () => {
    expect(tokenStep(HOUR_LONG, T0 - 60 * SECOND, CHECK)).toEqual({ kind: "send" })
    expect(tokenStep(HOUR_LONG, T0 - 61 * SECOND, CHECK)).toEqual({
      kind: "renew",
      tokens: { ...HOUR_LONG, receivedAt: T0 - 61 * SECOND },
    })
  })

  it("sends a token of a sign-in without a refresh token until it expires, the check due or not", () => {
    const plain = { ...HOUR_LONG, refreshToken: undefined }
    expect(tokenStep(plain, T0 + CHECK, CHECK)).toEqual({ kind: "send" })
    expect(tokenStep(plain, T0 + 60 * MINUTE, CHECK)).toEqual(EXPIRED_END)
  })

  it("ends the session at a due check once its refresh token expired, and not before", () => {
    // The provider's session is over (Keycloak's SSO Session Idle): nothing can check it.
    const spent = { ...HOUR_LONG, refreshExpiresAt: T0 + MINUTE }
    expect(tokenStep(spent, T0 + CHECK - 1, CHECK)).toEqual({ kind: "send" })
    expect(tokenStep(spent, T0 + CHECK, CHECK)).toEqual(UNCHECKED_END)
    expect(tokenStep(spent, T0 + 60 * MINUTE, CHECK)).toEqual(EXPIRED_END)
  })
})

describe("renewableAfterRefusal: the tokens to renew after the gate's 401", () => {
  it("renews a token old enough that a new one may help", () => {
    expect(renewableAfterRefusal(RECEIVED, T0 + 30 * SECOND)).toBe(RECEIVED)
  })

  it("never renews a young token, which the gate refused for another reason than its age", () => {
    expect(renewableAfterRefusal(RECEIVED, T0 + 29 * SECOND)).toBeUndefined()
    // A receipt in this replica's future counts as now: young too.
    expect(renewableAfterRefusal(RECEIVED, T0 - 60 * SECOND)).toBeUndefined()
  })

  it("renews nothing without a refresh token", () => {
    const plain = sessionTokens(T0, { refreshToken: undefined })
    expect(renewableAfterRefusal(plain, T0 + 60 * SECOND)).toBeUndefined()
  })
})

describe("renewalSource: the replica's refreshes", () => {
  it("asks the token endpoint as the confidential client, for the gate's resource", async () => {
    const provider = scriptedProvider(tokens("access-2"))
    provider.clock.now = DUE_AT
    const { ctx } = callContext(provider.platform)
    const renewal = await renewalSource(ctx)(RECEIVED)
    expect(renewal).toEqual({
      kind: "renewed",
      tokens: {
        accessToken: "access-2",
        receivedAt: DUE_AT,
        expiresAt: DUE_AT + 300 * SECOND,
        refreshToken: "refresh-1",
        refreshExpiresAt: undefined,
      },
    })
    expect(Object.fromEntries(provider.forms[0])).toEqual({
      grant_type: "refresh_token",
      refresh_token: "refresh-1",
      resource: RESOURCE,
    })
    const basic = Buffer.from("pulse-web:pulse-web-secret").toString("base64")
    expect(provider.authorizations).toEqual([`Basic ${basic}`])
  })

  it("keeps the refresh token and its expiry, unless the provider rotated it", async () => {
    const provider = scriptedProvider(
      tokens("access-2"),
      tokens("access-3", { refresh_token: "refresh-2" }),
      tokens("access-4", { refresh_token: "refresh-3", refresh_expires_in: 600 }),
    )
    const { ctx } = callContext(provider.platform)
    const renew = renewalSource(ctx)
    const held = { ...RECEIVED, refreshExpiresAt: T0 + 1800 * SECOND }
    expect(await renew(held)).toMatchObject({
      tokens: { refreshToken: "refresh-1", refreshExpiresAt: T0 + 1800 * SECOND },
    })
    expect(await renew({ ...held, refreshToken: "refresh-a" })).toMatchObject({
      tokens: { refreshToken: "refresh-2", refreshExpiresAt: undefined },
    })
    expect(await renew({ ...held, refreshToken: "refresh-b" })).toMatchObject({
      tokens: { refreshToken: "refresh-3", refreshExpiresAt: T0 + 600 * SECOND },
    })
  })

  it("runs one refresh per refresh token, and keeps its outcome 30 s for the same cookie", async () => {
    const provider = scriptedProvider(
      tokens("access-2", { refresh_token: "refresh-2" }),
      tokens("access-3"),
    )
    const { ctx } = callContext(provider.platform)
    const renew = renewalSource(ctx)
    const [first, second] = await Promise.all([renew(RECEIVED), renew(RECEIVED)])
    expect(second).toBe(first)
    provider.clock.now = T0 + RENEWAL_KEPT_MS - 1
    expect(await renew(RECEIVED)).toBe(first)
    expect(provider.forms).toHaveLength(1)
    // Once the outcome is 30 s old, the spent refresh token is sent again.
    provider.clock.now = T0 + RENEWAL_KEPT_MS
    expect(await renew(RECEIVED)).toMatchObject({ tokens: { accessToken: "access-3" } })
    expect(provider.forms).toHaveLength(2)
  })

  it("runs a refresh per pair of tokens: the same refresh token with a renewed access token renews again", async () => {
    // A provider that keeps its refresh token (RFC 6749 §6): the renewed cookie brings it again.
    const provider = scriptedProvider(tokens("access-2"), tokens("access-3"), tokens("access-4"))
    const { ctx } = callContext(provider.platform)
    const renew = renewalSource(ctx)
    expect(await renew(RECEIVED)).toMatchObject({ tokens: { accessToken: "access-2" } })
    const renewed = { ...RECEIVED, accessToken: "access-2" }
    expect(await renew(renewed)).toMatchObject({ tokens: { accessToken: "access-3" } })
    // Two pairs whose tokens join to the same text are two pairs all the same.
    const joined = { ...RECEIVED, refreshToken: "refresh-1access", accessToken: "-2" }
    expect(await renew(joined)).toMatchObject({ tokens: { accessToken: "access-4" } })
    expect(provider.forms.map((form) => form.get("refresh_token"))).toEqual([
      "refresh-1",
      "refresh-1",
      "refresh-1access",
    ])
  })

  it("keeps new tokens no longer than they hold, so a cookie that still brings the old pair renews again", async () => {
    // Tokens of 5 s: kept until they expire, short of the 30 s.
    const provider = scriptedProvider(
      tokens("access-2", { expires_in: 5 }),
      tokens("access-3", { expires_in: 5 }),
    )
    provider.clock.now = DUE_AT
    const { ctx } = callContext(provider.platform)
    const renew = renewalSource(ctx)
    const first = await renew(RECEIVED)
    provider.clock.now = DUE_AT + 5 * SECOND - 1
    expect(await renew(RECEIVED)).toBe(first)
    provider.clock.now = DUE_AT + 5 * SECOND
    expect(await renew(RECEIVED)).toMatchObject({ tokens: { accessToken: "access-3" } })
    expect(provider.forms).toHaveLength(2)
  })

  it("keeps new tokens of unknown lifetime 30 s", async () => {
    const unknown = { status: 200, body: { access_token: "access-2", token_type: "Bearer" } }
    const provider = scriptedProvider(unknown, tokens("access-3"))
    const { ctx } = callContext(provider.platform)
    const renew = renewalSource(ctx)
    const first = await renew(RECEIVED)
    provider.clock.now = T0 + RENEWAL_KEPT_MS - 1
    expect(await renew(RECEIVED)).toBe(first)
    provider.clock.now = T0 + RENEWAL_KEPT_MS
    expect(await renew(RECEIVED)).toMatchObject({ tokens: { accessToken: "access-3" } })
  })

  it("keeps the provider's refusal of a refresh token 30 s too, and logs it without a token", async () => {
    const provider = scriptedProvider(REFUSAL)
    const { ctx, logged } = callContext(provider.platform)
    const renew = renewalSource(ctx)
    expect(await renew(RECEIVED)).toEqual(FIRST)
    provider.clock.now = T0 + RENEWAL_KEPT_MS - 1
    expect(await renew(RECEIVED)).toEqual(FIRST)
    expect(provider.forms).toHaveLength(1)
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatch(/^Web session: the refresh gave no token \(.+\)\.$/)
    expect(logged[0]).not.toContain("refresh-1")
  })

  it("strikes a refusal: the first of a pair, the next of the same pair final", async () => {
    // The first may be a race with another replica's renewal; the second is the provider's word.
    const provider = scriptedProvider(REFUSAL, REFUSAL, REFUSAL)
    const { ctx } = callContext(provider.platform)
    const renew = renewalSource(ctx)
    expect(await renew(RECEIVED)).toEqual(FIRST)
    provider.clock.now = T0 + RENEWAL_KEPT_MS
    expect(await renew(RECEIVED)).toEqual(FINAL)
    // Another pair's refusal is a first one of its own.
    expect(await renew({ ...RECEIVED, accessToken: "access-0" })).toEqual(FIRST)
    expect(provider.forms).toHaveLength(3)
  })

  it("remembers a refused pair while its access token holds, without a check", async () => {
    const strikes = async (at: number) => {
      const provider = scriptedProvider(REFUSAL, REFUSAL)
      const renew = renewalSource(callContext(provider.platform).ctx)
      await renew(RECEIVED)
      provider.clock.now = at
      return renew(RECEIVED)
    }
    expect(await strikes(EXPIRES_AT - 1)).toEqual(FINAL)
    expect(await strikes(EXPIRES_AT)).toEqual(FIRST)
  })

  it("remembers a refused pair for one check's interval, also where its tokens' lifetime is unknown", async () => {
    const unknown = { ...RECEIVED, expiresAt: undefined }
    const strikes = async (at: number) => {
      const provider = scriptedProvider(REFUSAL, REFUSAL)
      const renew = renewalSource(callContext(provider.platform, checkedEvery(5)).ctx)
      await renew(unknown)
      provider.clock.now = at
      return renew(unknown)
    }
    expect(await strikes(T0 + CHECK - 1)).toEqual(FINAL)
    expect(await strikes(T0 + CHECK)).toEqual(FIRST)
  })

  it("remembers a refused pair while its token holds where that outlasts the check's interval", async () => {
    const provider = scriptedProvider(REFUSAL, REFUSAL)
    const renew = renewalSource(callContext(provider.platform, checkedEvery(5)).ctx)
    expect(await renew(HOUR_LONG)).toEqual(FIRST)
    provider.clock.now = T0 + 60 * MINUTE - 1
    expect(await renew(HOUR_LONG)).toEqual(FINAL)
  })

  it("keeps it as long as the transport holds an endpoint that cannot answer now", () => {
    expect(SILENT_KEPT_MS).toBe(new TokenFailure("unavailable").holdMs)
  })

  it.each([
    ["answers 503", { status: 503, body: {} }],
    ["is unreachable", "unreachable" as const],
    ["limits the requests", { status: 429, body: {} }],
    [
      "answers temporarily_unavailable",
      { status: 400, body: { error: "temporarily_unavailable" } },
    ],
    ["answers server_error", { status: 400, body: { error: "server_error" } }],
  ])("keeps it 5 s, then asks again, when the provider %s", async (_label, answer) => {
    const provider = scriptedProvider(answer, tokens("access-2"))
    const { ctx } = callContext(provider.platform)
    const renew = renewalSource(ctx)
    expect(await renew(RECEIVED)).toEqual({ kind: "unavailable" })
    provider.clock.now = T0 + SILENT_KEPT_MS - 1
    expect(await renew(RECEIVED)).toEqual({ kind: "unavailable" })
    expect(provider.forms).toHaveLength(1)
    provider.clock.now = T0 + SILENT_KEPT_MS
    expect(await renew(RECEIVED)).toMatchObject({ kind: "renewed" })
  })

  it("gives up on a refresh after 10 s, and the calls within the next 5 s take that at once", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const provider = scriptedProvider("hangs", tokens("access-2"))
    const { ctx, logged } = callContext(provider.platform)
    const renew = renewalSource(ctx)
    let settled = false
    const pending = renew(RECEIVED).finally(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toEqual({ kind: "unavailable" })
    expect(logged).toEqual(["Web session: the refresh gave no token (no token: timeout)."])
    provider.clock.now = T0 + SILENT_KEPT_MS - 1
    expect(await renew(RECEIVED)).toEqual({ kind: "unavailable" })
    expect(provider.forms).toHaveLength(1)
  })

  it("asks no token endpoint while the provider's metadata does not load", async () => {
    const provider = scriptedProvider()
    const { ctx } = callContext(provider.platform, { metadata: () => Promise.resolve(undefined) })
    expect(await renewalSource(ctx)(RECEIVED)).toEqual({ kind: "unavailable" })
    expect(provider.forms).toEqual([])
  })
})
