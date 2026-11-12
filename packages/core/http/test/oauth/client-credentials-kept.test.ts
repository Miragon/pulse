// Client credentials whose renewal fails before the token expires keep that token, as a login's
// renewal does (owner decision 2026-11-10; the C8 adapter of #543 failed the request): it goes
// out until it expires, and the endpoint is asked again by the hold. A refusal fails at once.
import { describe, expect, it } from "vitest"
import {
  clientCredentialsTokens,
  type ClientCredentialsOptions,
  memoryTokenStore,
  type TokenStore,
} from "../../src/oauth/index.js"
import { jsonAnswer } from "../fake-fetch.js"
import { failureOf, TOKEN_URL, TokenServer } from "./support.js"

const LIFETIME_S = 3600
/** When a token of LIFETIME_S is due: 60 s before it expires. */
const RENEW_AT_MS = (LIFETIME_S - 60) * 1000

const unreachable = () => {
  throw new TypeError("fetch failed")
}
const unavailable = () => new Response("", { status: 503 })

function tokensOf(server: TokenServer, overrides: Partial<ClientCredentialsOptions> = {}) {
  return clientCredentialsTokens({
    endpoint: { url: TOKEN_URL, clientId: "pulse", clientSecret: "s3cret", clientAuth: "post" },
    grant: { type: "client_credentials" },
    platform: server.platform,
    ...overrides,
  })
}

/** A source that holds token-1 with the clock where it is due, the endpoint answering by `answer`. */
async function inMargin(answer: () => Response) {
  const server = new TokenServer()
  const tokens = tokensOf(server)
  await tokens.token()
  server.clock.now += RENEW_AT_MS
  server.answer = answer
  return { server, tokens }
}

/** A memory store whose lock, reading or writing fails while the test says so. */
function failingStore() {
  const memory = memoryTokenStore()
  const busy = new Error("locked")
  const unreadable = new Error("unreadable")
  const unwritable = new Error("unwritable")
  const state = { busy: false, unreadable: false, unwritable: false }
  const store: TokenStore = {
    read: (key) => (state.unreadable ? Promise.reject(unreadable) : memory.read(key)),
    write: (key, record) =>
      state.unwritable ? Promise.reject(unwritable) : memory.write(key, record),
    exclusive: (key, work) => (state.busy ? Promise.reject(busy) : memory.exclusive(key, work)),
  }
  return { store, state, busy, unreadable, unwritable }
}

describe("a renewal that fails before the token expires", () => {
  it.each([
    ["no connection", unreachable],
    ["a server error", unavailable],
    ["a gateway timeout", () => new Response("", { status: 504 })],
    ["a rate limit", () => new Response("", { status: 429 })],
  ])("keeps the token that is still valid after %s", async (_name, answer) => {
    const { server, tokens } = await inMargin(answer)
    await expect(tokens.token()).resolves.toBe("token-1")
    expect(server.requests).toBe(2)
  })

  it("asks once for parallel reads, and each of them sends the kept token", async () => {
    const { server, tokens } = await inMargin(unavailable)
    const reads = await Promise.all([tokens.token(), tokens.token(), tokens.token()])
    expect(reads).toEqual(["token-1", "token-1", "token-1"])
    expect(server.requests).toBe(2)
  })

  it("sends it during the hold without asking, and renews once the hold ends", async () => {
    const { server, tokens } = await inMargin(unavailable)
    await tokens.token()
    server.clock.now += 4_999
    await expect(tokens.token()).resolves.toBe("token-1")
    expect(server.requests).toBe(2)
    server.clock.now += 1
    await expect(tokens.token()).resolves.toBe("token-1")
    expect(server.requests).toBe(3)
    server.answer = () => jsonAnswer({ access_token: "renewed", expires_in: LIFETIME_S })
    server.clock.now += 5_000
    await expect(tokens.token()).resolves.toBe("renewed")
    await expect(tokens.token()).resolves.toBe("renewed")
    expect(server.requests).toBe(4)
  })

  it("waits out a rate limit as its Retry-After asks, the token sent meanwhile", async () => {
    const limited = () => new Response("", { status: 429, headers: { "Retry-After": "30" } })
    const { server, tokens } = await inMargin(limited)
    await expect(tokens.token()).resolves.toBe("token-1")
    server.clock.now += 29_999
    await expect(tokens.token()).resolves.toBe("token-1")
    expect(server.requests).toBe(2)
    server.clock.now += 1
    await expect(tokens.token()).resolves.toBe("token-1")
    expect(server.requests).toBe(3)
  })

  it("fails once the token expired, with what its renewal got", async () => {
    const { server, tokens } = await inMargin(unavailable)
    server.clock.now += 59_999
    await expect(tokens.token()).resolves.toBe("token-1")
    server.clock.now += 1
    expect(await failureOf(tokens.token())).toMatchObject({ kind: "unavailable", status: 503 })
    server.clock.now += 5_000
    server.answer = unreachable
    expect(await failureOf(tokens.token())).toMatchObject({ kind: "unreachable" })
    expect(server.requests).toBe(3)
  })

  it("fails when the token expires while its renewal waits for an answer", async () => {
    const { server, tokens } = await inMargin(unavailable)
    server.answer = () => {
      server.clock.now += 60_000
      return unavailable()
    }
    expect(await failureOf(tokens.token())).toMatchObject({ kind: "unavailable" })
  })

  it("keeps a token whose answer named no lifetime for the 300 s it is assumed to live", async () => {
    const server = new TokenServer()
    server.answer = () => jsonAnswer({ access_token: "plain" })
    const tokens = tokensOf(server)
    await tokens.token()
    server.answer = unavailable
    server.clock.now += 299_999
    await expect(tokens.token()).resolves.toBe("plain")
    server.clock.now += 1
    expect(await failureOf(tokens.token())).toMatchObject({ kind: "unavailable" })
  })

  it.each([
    ["a refused client", () => jsonAnswer({ error: "invalid_client" }, 401), "client"],
    ["a refused scope", () => jsonAnswer({ error: "invalid_scope" }, 400), "scope"],
    ["a forbidden client", () => new Response("", { status: 403 }), "forbidden"],
    ["a redirect", () => new Response("", { status: 302 }), "redirect"],
    ["no token", () => jsonAnswer({ token_type: "Bearer" }), "unexpected"],
  ])("fails at once after %s, also during its hold", async (_name, answer, kind) => {
    const { server, tokens } = await inMargin(answer)
    expect(await failureOf(tokens.token())).toMatchObject({ kind })
    server.clock.now += 1_000
    expect(await failureOf(tokens.token())).toMatchObject({ kind })
    expect(server.requests).toBe(2)
  })

  it("sends the kept token no more once the API refused it", async () => {
    const { tokens } = await inMargin(unavailable)
    await expect(tokens.rejected(String(await tokens.token()))).resolves.toBe(true)
    expect(await failureOf(tokens.token())).toMatchObject({ kind: "unavailable" })
  })
})

describe("a renewal that fails, with a store", () => {
  it("never keeps a token the API refused, nor one in the store", async () => {
    for (const store of [undefined, memoryTokenStore()]) {
      const server = new TokenServer()
      const tokens = tokensOf(server, store === undefined ? {} : { store })
      const first = String(await tokens.token())
      server.clock.now += 60 * 1000
      await tokens.rejected(first)
      server.answer = unavailable
      expect(await failureOf(tokens.token())).toMatchObject({ kind: "unavailable" })
    }
  })

  it("lets a source built anew keep the stored token until it expires", async () => {
    const server = new TokenServer()
    const store = memoryTokenStore()
    await tokensOf(server, { store }).token()
    server.clock.now += RENEW_AT_MS
    server.answer = unavailable
    await expect(tokensOf(server, { store }).token()).resolves.toBe("token-1")
    server.clock.now += 60_000
    const anew = tokensOf(server, { store })
    expect(await failureOf(anew.token())).toMatchObject({ kind: "unavailable" })
  })

  it("keeps the token another source renewed when it lives longer than its own", async () => {
    const server = new TokenServer()
    const store = memoryTokenStore()
    const first = tokensOf(server, { store })
    const second = tokensOf(server, { store })
    await expect(first.token()).resolves.toBe("token-1")
    server.clock.now += RENEW_AT_MS
    await expect(second.token()).resolves.toBe("token-2")
    server.clock.now += RENEW_AT_MS
    server.answer = unavailable
    await expect(first.token()).resolves.toBe("token-2")
  })

  it("keeps its own token when the store holds an older one", async () => {
    const { store, state, unwritable } = failingStore()
    const server = new TokenServer()
    const tokens = tokensOf(server, { store })
    await tokens.token()
    server.clock.now += RENEW_AT_MS
    state.unwritable = true
    await expect(tokens.token()).rejects.toBe(unwritable)
    state.unwritable = false
    await expect(tokens.token()).resolves.toBe("token-2")
    server.clock.now += RENEW_AT_MS
    server.answer = unavailable
    await expect(tokens.token()).resolves.toBe("token-2")
  })

  it("keeps it when the store cannot take its lock, and nothing is sent", async () => {
    const { store, state, busy } = failingStore()
    const server = new TokenServer()
    const tokens = tokensOf(server, { store })
    await tokens.token()
    state.busy = true
    server.clock.now += RENEW_AT_MS
    await expect(tokens.token()).resolves.toBe("token-1")
    expect(server.requests).toBe(1)
    server.clock.now += 60_000
    await expect(tokens.token()).rejects.toBe(busy)
  })

  it("fails for a store that fails under its lock, although the token is still valid", async () => {
    const { store, state, unreadable } = failingStore()
    const server = new TokenServer()
    const tokens = tokensOf(server, { store })
    await tokens.token()
    state.unreadable = true
    server.clock.now += RENEW_AT_MS
    await expect(tokens.token()).rejects.toBe(unreadable)
  })
})
