import { describe, expect, it } from "vitest"
import {
  callContext,
  scriptedProvider,
  SECOND,
  sessionTokens,
  T0,
  tokens,
} from "./call.test-support.js"
import {
  RENEWAL_KEPT_MS,
  renewableAfterRefusal,
  renewalSource,
  seenAt,
  tokenStep,
  type RenewableTokens,
} from "./refresh.js"
import { RESOURCE } from "./sign-in.test-support.js"

/** Tokens of five minutes, renewed 30 s before they expire (a tenth of their lifetime). */
const RECEIVED = sessionTokens(T0) as RenewableTokens
const DUE_AT = T0 + 270 * SECOND
const EXPIRES_AT = T0 + 300 * SECOND

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
    expect(tokenStep(plain, EXPIRES_AT)).toEqual({ kind: "end" })
    const spent = sessionTokens(T0, { refreshExpiresAt: EXPIRES_AT })
    expect(tokenStep(spent, EXPIRES_AT)).toEqual({ kind: "end" })
  })

  it("never renews a token another replica received by a clock that runs ahead", () => {
    // Received at T0 by a clock five minutes ahead of this one: without the clamp the policy
    // would find it due on every call, a clock that stepped back.
    expect(tokenStep(RECEIVED, T0 - 300 * SECOND)).toEqual({ kind: "send" })
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

  it("keeps the provider's refusal of a refresh token 30 s too, and logs it without a token", async () => {
    const refusal = { status: 400, body: { error: "invalid_grant" } }
    const provider = scriptedProvider(refusal)
    const { ctx, logged } = callContext(provider.platform)
    const renew = renewalSource(ctx)
    expect(await renew(RECEIVED)).toEqual({ kind: "refused" })
    expect(await renew(RECEIVED)).toEqual({ kind: "refused" })
    expect(provider.forms).toHaveLength(1)
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatch(/^Web session: the refresh gave no token \(.+\)\.$/)
    expect(logged[0]).not.toContain("refresh-1")
  })

  it.each([
    ["answers 503", { status: 503, body: {} }],
    ["is unreachable", "unreachable" as const],
    ["limits the requests", { status: 429, body: {} }],
  ])("asks again on the next call when the provider %s", async (_label, answer) => {
    const provider = scriptedProvider(answer, tokens("access-2"))
    const { ctx } = callContext(provider.platform)
    const renew = renewalSource(ctx)
    expect(await renew(RECEIVED)).toEqual({ kind: "unavailable" })
    expect(await renew(RECEIVED)).toMatchObject({ kind: "renewed" })
  })

  it("asks no token endpoint while the provider's metadata does not load", async () => {
    const provider = scriptedProvider()
    const { ctx } = callContext(provider.platform, { metadata: () => Promise.resolve(undefined) })
    expect(await renewalSource(ctx)(RECEIVED)).toEqual({ kind: "unavailable" })
    expect(provider.forms).toEqual([])
  })
})
