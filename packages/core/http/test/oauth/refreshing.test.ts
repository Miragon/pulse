import { describe, expect, it } from "vitest"
import {
  memoryTokenStore,
  type RefreshingOptions,
  refreshingTokens,
  type TokenRecord,
  type TokenStore,
} from "../../src/oauth/index.js"
import { jsonAnswer } from "../fake-fetch.js"
import { failureOf, omit, T0, TOKEN_URL, TokenServer } from "./support.js"

const KEY = "login"
const LOGIN: TokenRecord = {
  accessToken: "cached-access",
  receivedAt: T0,
  expiresAt: T0 + 300_000,
  refreshToken: "cached-refresh",
  refreshExpiresAt: T0 + 1_800_000,
  scope: "openid",
  idToken: "old.id.token",
}
/** When LOGIN is due: 30 s (a tenth of 300 s) before it expires. */
const DUE = T0 + 270_000

function rotating(server: TokenServer, extra: Record<string, unknown> = {}) {
  server.answer = (form) =>
    jsonAnswer({
      access_token: `access-${String(server.requests)}`,
      expires_in: 300,
      refresh_token: `refresh-${String(server.requests)}`,
      refresh_expires_in: 1800,
      seen: form.get("refresh_token"),
      ...extra,
    })
}

async function setup(record: TokenRecord | null = LOGIN, options: Partial<RefreshingOptions> = {}) {
  const server = new TokenServer()
  rotating(server)
  const store = memoryTokenStore()
  if (record !== null) await store.write(KEY, record)
  const kept: unknown[] = []
  const tokens = (overrides: Partial<RefreshingOptions> = {}) =>
    refreshingTokens({
      endpoint: { url: TOKEN_URL, clientId: "pulse-cli", clientAuth: "none" },
      key: KEY,
      store,
      platform: server.platform,
      kept: (failure) => kept.push(failure),
      ...options,
      ...overrides,
    })
  return { server, store, tokens, kept, stored: () => store.read(KEY) }
}

describe("a login's tokens", () => {
  it("send the stored access token until it is due, reading the store once", async () => {
    const test = await setup()
    const tokens = test.tokens()
    await expect(tokens.token()).resolves.toBe("cached-access")
    await test.store.write(KEY, { ...LOGIN, accessToken: "changed" })
    test.server.clock.now = DUE - 1
    await expect(tokens.token()).resolves.toBe("cached-access")
    expect(test.server.requests).toBe(0)
    expect(tokens.renewable).toBe(true)
  })

  it("refresh when due, store the rotated refresh token and the new expiries", async () => {
    const test = await setup()
    test.server.clock.now = DUE
    await expect(test.tokens().token()).resolves.toBe("access-1")
    expect(test.server.forms[0]?.get("refresh_token")).toBe("cached-refresh")
    await expect(test.stored()).resolves.toEqual({
      accessToken: "access-1",
      receivedAt: DUE,
      expiresAt: DUE + 300_000,
      refreshToken: "refresh-1",
      refreshExpiresAt: DUE + 1_800_000,
      scope: "openid",
      idToken: "old.id.token",
    })
  })

  it("keep the old refresh token and its expiry when the server returns none", async () => {
    const test = await setup()
    test.server.answer = () =>
      jsonAnswer({ access_token: "a2", scope: "openid more", id_token: "new.id.token" })
    test.server.clock.now = DUE
    await test.tokens().token()
    await expect(test.stored()).resolves.toEqual({
      accessToken: "a2",
      receivedAt: DUE,
      refreshToken: "cached-refresh",
      refreshExpiresAt: T0 + 1_800_000,
      scope: "openid more",
      idToken: "new.id.token",
    })
  })

  it("forget the refresh expiry after a rotation without one", async () => {
    const bare = omit(LOGIN, "scope", "idToken")
    const test = await setup(bare)
    test.server.answer = () => jsonAnswer({ access_token: "a2", refresh_token: "r2" })
    test.server.clock.now = DUE
    await test.tokens().token()
    await expect(test.stored()).resolves.toEqual({
      accessToken: "a2",
      receivedAt: DUE,
      refreshToken: "r2",
    })
  })

  it("refresh again once the refreshed token is due", async () => {
    const test = await setup()
    const tokens = test.tokens()
    test.server.clock.now = DUE
    await expect(tokens.token()).resolves.toBe("access-1")
    test.server.clock.now = DUE + 270_000
    await expect(tokens.token()).resolves.toBe("access-2")
    expect(test.server.forms.map((form) => form.get("refresh_token"))).toEqual([
      "cached-refresh",
      "refresh-1",
    ])
  })

  it("renew by the policy handed in", async () => {
    const test = await setup()
    const early = { maxMarginMs: 200_000, lifetimeShare: 1, floorMs: 0, youngTokenMs: 0 }
    test.server.clock.now = T0 + 100_000
    await expect(test.tokens({ policy: early }).token()).resolves.toBe("access-1")
    await expect(test.tokens().token()).resolves.toBe("access-1")
  })

  it("share one refresh between concurrent calls", async () => {
    const test = await setup()
    test.server.clock.now = DUE
    const tokens = test.tokens()
    await expect(Promise.all([tokens.token(), tokens.token(), tokens.token()])).resolves.toEqual([
      "access-1",
      "access-1",
      "access-1",
    ])
    expect(test.server.requests).toBe(1)
  })

  it("refresh when the clock stands before the receipt", async () => {
    const test = await setup()
    test.server.clock.now = T0 - 1
    await expect(test.tokens().token()).resolves.toBe("access-1")
  })

  it("use a due token that cannot be refreshed until it expires, then fail as expired", async () => {
    const noRefresh = omit(LOGIN, "refreshToken")
    const test = await setup(noRefresh)
    test.server.clock.now = DUE
    await expect(test.tokens().token()).resolves.toBe("cached-access")
    test.server.clock.now = T0 + 300_000
    expect(await failureOf(test.tokens().token())).toMatchObject({ kind: "expired" })
    const lapsed = await setup({ ...LOGIN, refreshExpiresAt: T0 + 100_000 })
    lapsed.server.clock.now = T0 + 300_000
    expect(await failureOf(lapsed.tokens().token())).toMatchObject({ kind: "expired" })
    expect(test.server.requests + lapsed.server.requests).toBe(0)
  })

  it("fail as expired when the store holds no login", async () => {
    const test = await setup(null)
    expect(await failureOf(test.tokens().token())).toMatchObject({ kind: "expired" })
  })
})

describe("another process", () => {
  it("is taken over when it refreshed already, without a request", async () => {
    const test = await setup()
    const [leader, follower] = [test.tokens(), test.tokens()]
    await follower.token()
    test.server.clock.now = DUE
    await expect(leader.token()).resolves.toBe("access-1")
    await expect(follower.token()).resolves.toBe("access-1")
    expect(test.server.requests).toBe(1)
  })

  it("rotated the refresh token: the stored one goes out, never the one in memory", async () => {
    const test = await setup()
    const tokens = test.tokens()
    await tokens.token()
    await test.store.write(KEY, { ...LOGIN, refreshToken: "rotated-refresh" })
    test.server.clock.now = DUE
    await tokens.token()
    expect(test.server.forms.map((form) => form.get("refresh_token"))).toEqual(["rotated-refresh"])
  })

  it("left a newer token that expired already: the stored refresh token renews it", async () => {
    const test = await setup()
    const tokens = test.tokens()
    await tokens.token()
    await test.store.write(KEY, {
      ...LOGIN,
      accessToken: "newer",
      expiresAt: T0 + 100_000,
      refreshToken: "newer-refresh",
    })
    test.server.clock.now = DUE
    await expect(tokens.token()).resolves.toBe("access-1")
    expect(test.server.forms[0]?.get("refresh_token")).toBe("newer-refresh")
  })

  it("removed the login, or left one without a refresh token: expired", async () => {
    const removed = await setup()
    const tokens = removed.tokens()
    await tokens.token()
    await removed.store.write(KEY, { ...LOGIN, refreshToken: undefined })
    removed.server.clock.now = DUE
    expect(await failureOf(tokens.token())).toMatchObject({ kind: "expired" })
    let reads = 0
    const gone: TokenStore = {
      ...removed.store,
      read: () => Promise.resolve(reads++ === 0 ? LOGIN : undefined),
    }
    const vanished = await setup(LOGIN, { store: gone })
    vanished.server.clock.now = DUE
    expect(await failureOf(vanished.tokens().token())).toMatchObject({ kind: "expired" })
    expect(removed.server.requests).toBe(0)
  })
})

describe("a refused refresh token", () => {
  it("is recorded, the tokens unchanged, so nothing asks with it again", async () => {
    const test = await setup()
    test.server.answer = () =>
      jsonAnswer({ error: "invalid_grant", error_description: "Session not active" }, 400)
    test.server.clock.now = DUE
    const tokens = test.tokens()
    expect(await failureOf(tokens.token())).toMatchObject({ kind: "grant", error: "invalid_grant" })
    await expect(test.stored()).resolves.toEqual({
      ...LOGIN,
      refreshRejected: { at: DUE, error: "invalid_grant", description: "Session not active" },
    })
    const later = await failureOf(test.tokens().token())
    expect(later).toMatchObject({
      kind: "grant",
      error: "invalid_grant",
      description: "Session not active",
      recordedAt: DUE,
    })
    expect(test.server.requests).toBe(1)
  })

  it("is recorded for any refusal of the grant, never for the client's or a passing one", async () => {
    const other = await setup()
    other.server.answer = () => jsonAnswer({ error: "not_allowed" }, 400)
    other.server.clock.now = DUE
    await failureOf(other.tokens().token())
    await expect(other.stored()).resolves.toMatchObject({
      refreshRejected: { at: DUE, error: "not_allowed" },
    })
    for (const answer of [
      jsonAnswer({ error: "invalid_client" }, 401),
      new Response("", { status: 503 }),
    ]) {
      const test = await setup()
      test.server.answer = () => answer
      test.server.clock.now = T0 + 300_000
      await failureOf(test.tokens().token())
      await expect(test.stored()).resolves.toEqual(LOGIN)
    }
  })

  it("is reported even when it cannot be recorded", async () => {
    const test = await setup()
    const store = { ...test.store, write: () => Promise.reject(new Error("EROFS")) }
    test.server.answer = () => jsonAnswer({ error: "invalid_grant" }, 400)
    test.server.clock.now = DUE
    expect(await failureOf(test.tokens({ store }).token())).toMatchObject({ kind: "grant" })
  })

  it("is recorded when it was refused by another process meanwhile", async () => {
    const test = await setup()
    const tokens = test.tokens()
    await tokens.token()
    await test.store.write(KEY, { ...LOGIN, refreshRejected: { at: T0, error: "invalid_grant" } })
    test.server.clock.now = DUE
    expect(await failureOf(tokens.token())).toMatchObject({ kind: "grant", recordedAt: T0 })
    expect(test.server.requests).toBe(0)
  })
})

describe("a passing failure of a renewal", () => {
  it.each([
    [
      "no connection",
      () => {
        throw new TypeError("fetch failed")
      },
    ],
    ["a server error", () => new Response("", { status: 503 })],
    ["a rate limit", () => new Response("", { status: 429 })],
  ])("keeps the still valid token after %s and says so", async (_name, answer) => {
    const test = await setup()
    test.server.answer = answer
    test.server.clock.now = DUE
    await expect(test.tokens().token()).resolves.toBe("cached-access")
    expect(test.kept).toHaveLength(1)
  })

  it("keeps it when the lock cannot be taken: the store's own failure is told", async () => {
    const busy = new Error("locked")
    const test = await setup()
    const store = { ...test.store, exclusive: () => Promise.reject(busy) }
    test.server.clock.now = DUE
    await expect(test.tokens({ store }).token()).resolves.toBe("cached-access")
    expect(test.kept).toEqual([busy])
    expect(test.server.requests).toBe(0)
    const quiet = refreshingTokens({
      endpoint: { url: TOKEN_URL, clientId: "pulse-cli", clientAuth: "none" },
      key: KEY,
      store,
      platform: test.server.platform,
    })
    await expect(quiet.token()).resolves.toBe("cached-access")
  })

  it("fails once the token expired, or for a failure that does not pass", async () => {
    const busy = new Error("locked")
    const expired = await setup()
    const store = { ...expired.store, exclusive: () => Promise.reject(busy) }
    expired.server.clock.now = T0 + 300_000
    await expect(expired.tokens({ store }).token()).rejects.toBe(busy)
    const broken = await setup()
    let reads = 0
    const failing = new Error("unreadable")
    const store2: TokenStore = {
      ...broken.store,
      read: (key) => (reads++ === 0 ? broken.store.read(key) : Promise.reject(failing)),
    }
    broken.server.clock.now = DUE
    await expect(broken.tokens({ store: store2 }).token()).rejects.toBe(failing)
    expect(broken.kept).toEqual([])
  })
})

describe("a 401", () => {
  it("renews a token old enough, once: the renewed one is young", async () => {
    const test = await setup()
    const tokens = test.tokens()
    test.server.clock.now = T0 + 30_000
    await expect(tokens.rejected(String(await tokens.token()))).resolves.toBe(true)
    await expect(tokens.token()).resolves.toBe("access-1")
    await expect(tokens.rejected("access-1")).resolves.toBe(false)
    expect(test.server.requests).toBe(1)
  })

  it("is the only renewal of a token whose answer named no lifetime, a young one kept", async () => {
    const test = await setup(omit(LOGIN, "expiresAt", "refreshExpiresAt"))
    const tokens = test.tokens()
    test.server.clock.now = T0 + 29_999
    await expect(tokens.rejected(String(await tokens.token()))).resolves.toBe(false)
    test.server.clock.now = T0 + 10 * 3_600_000
    await expect(tokens.token()).resolves.toBe("cached-access")
    expect(test.server.requests).toBe(0)
    await expect(tokens.rejected("cached-access")).resolves.toBe(true)
    await expect(tokens.token()).resolves.toBe("access-1")
    expect(test.server.requests).toBe(1)
  })

  it("keeps a young token or one without a refresh token, and lets another renewal count", async () => {
    const test = await setup()
    const tokens = test.tokens()
    await expect(tokens.rejected(String(await tokens.token()))).resolves.toBe(false)
    await expect(tokens.rejected("an older one")).resolves.toBe(true)
    const noRefresh = omit(LOGIN, "refreshToken")
    const bare = await setup(noRefresh)
    bare.server.clock.now = T0 + 60_000
    await expect(bare.tokens().rejected("cached-access")).resolves.toBe(false)
    expect(test.server.requests + bare.server.requests).toBe(0)
  })

  it("takes over a new login that replaced a refused one", async () => {
    const test = await setup({ ...LOGIN, refreshRejected: { at: T0, error: "invalid_grant" } })
    const tokens = test.tokens()
    await failureOf(tokens.token())
    await test.store.write(KEY, { ...LOGIN, accessToken: "new-login" })
    test.server.clock.now = T0 + 60_000
    await expect(tokens.rejected("cached-access")).resolves.toBe(true)
    await expect(tokens.token()).resolves.toBe("new-login")
    expect(test.server.requests).toBe(0)
  })

  it("throws what the renewal threw, the store's own failure for a busy lock", async () => {
    const test = await setup()
    test.server.answer = () => jsonAnswer({ error: "invalid_grant" }, 400)
    test.server.clock.now = T0 + 60_000
    expect(await failureOf(test.tokens().rejected("cached-access"))).toMatchObject({
      kind: "grant",
    })
    const busy = new Error("locked")
    const store = { ...test.store, exclusive: () => Promise.reject(busy) }
    const fresh = await setup()
    fresh.server.clock.now = T0 + 60_000
    await expect(fresh.tokens({ store }).rejected("cached-access")).rejects.toBe(busy)
  })
})
