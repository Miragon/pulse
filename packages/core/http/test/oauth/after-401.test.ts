// A 401 on the transport costs one renewal, also for a token the shared policy finds due at once
// (a lifetime of 5 s or less): the token a source renewed for the 401 goes out with the second
// attempt as it is. The CLI's engine suite checks the same over Keycloak's 5 s tokens.
import { describe, expect, it } from "vitest"
import { bearerCredential, createHttp, type TokenSource } from "../../src/index.js"
import {
  clientCredentialsTokens,
  commandTokens,
  memoryTokenStore,
  refreshingTokens,
} from "../../src/oauth/index.js"
import { jsonAnswer, scriptedFetch } from "../fake-fetch.js"
import { T0, TOKEN_URL, TokenServer } from "./support.js"

const ENGINE = "https://engine.test/rest"
const ENDPOINT = { url: TOKEN_URL, clientId: "pulse", clientAuth: "none" } as const

/** A read through a transport over `source`: the engine refuses the first token, takes the next. */
async function readAfter401(source: TokenSource, clock: { readonly now: number }) {
  const engine = scriptedFetch([new Response(null, { status: 401 }), jsonAnswer({ count: 1 })])
  const http = createHttp(
    { url: ENGINE, credential: bearerCredential(source), timeoutMs: 1_000 },
    { fetch: engine.fetch, now: () => clock.now },
  )
  const count = await http.json({ method: "GET", url: `${ENGINE}/count`, intent: "read" })
  return { count, sent: engine.calls.map((call) => call.headers.authorization) }
}

/** A login a minute old, renewed with tokens of `expiresIn` seconds: `access-<n>`. */
async function login(expiresIn: number) {
  const server = new TokenServer()
  server.answer = () =>
    jsonAnswer({
      access_token: `access-${String(server.requests)}`,
      expires_in: expiresIn,
      refresh_token: `refresh-${String(server.requests)}`,
    })
  const store = memoryTokenStore()
  await store.write("login", {
    accessToken: "cached-access",
    receivedAt: T0,
    expiresAt: T0 + 3_600_000,
    refreshToken: "cached-refresh",
  })
  server.clock.now = T0 + 60_000
  const source = refreshingTokens({
    endpoint: ENDPOINT,
    key: "login",
    store,
    platform: server.platform,
  })
  return { server, source }
}

describe("a 401 on the transport", () => {
  it("costs a login one refresh, its 5 s token sent with the second attempt", async () => {
    const { server, source } = await login(5)
    await expect(readAfter401(source, server.clock)).resolves.toEqual({
      count: { count: 1 },
      sent: ["Bearer cached-access", "Bearer access-1"],
    })
    expect(server.requests).toBe(1)
  })

  it("costs a token command one run, its 5 s token sent with the second attempt", async () => {
    const clock = { now: T0 + 30_000 }
    const printed = ["opaque-1", "opaque-2"]
    let runs = 0
    const source = commandTokens(
      () => {
        runs += 1
        return Promise.resolve(printed[runs - 1] ?? "")
      },
      {
        key: "command",
        now: () => clock.now,
        expiryOf: (token) => (token === "opaque-2" ? clock.now + 5_000 : undefined),
      },
    )
    await source.token()
    clock.now += 30_000
    await expect(readAfter401(source, clock)).resolves.toEqual({
      count: { count: 1 },
      sent: ["Bearer opaque-1", "Bearer opaque-2"],
    })
    expect(runs).toBe(2)
  })

  it("costs client credentials one request, the 5 s token sent with the second attempt", async () => {
    const server = new TokenServer()
    server.answer = () =>
      jsonAnswer({
        access_token: `token-${String(server.requests)}`,
        expires_in: server.requests === 1 ? 3600 : 5,
      })
    const source = clientCredentialsTokens({
      endpoint: ENDPOINT,
      grant: { type: "client_credentials" },
      platform: server.platform,
    })
    await source.token()
    server.clock.now += 30_000
    await expect(readAfter401(source, server.clock)).resolves.toEqual({
      count: { count: 1 },
      sent: ["Bearer token-1", "Bearer token-2"],
    })
    expect(server.requests).toBe(2)
  })
})

describe("the token a 401 renewed", () => {
  it("goes out once as it is; the next request renews it by the policy", async () => {
    const { server, source } = await login(5)
    await expect(source.rejected(String(await source.token()))).resolves.toBe(true)
    await expect(source.token()).resolves.toBe("access-1")
    expect(server.requests).toBe(1)
    await expect(source.token()).resolves.toBe("access-2")
  })

  it("is renewed again when it expired before it went out", async () => {
    const { server, source } = await login(1)
    await source.rejected(String(await source.token()))
    server.clock.now += 1_000
    await expect(source.token()).resolves.toBe("access-2")
  })
})
