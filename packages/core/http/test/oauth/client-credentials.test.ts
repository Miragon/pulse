// Ported from the C8 adapter of Pulse for VS Code (#543, Thomas Heinrichs:
// test/adapters/c8/c8-auth.test.ts) onto the package's token source: the adapter's wording of a
// failure stays with the adapter, so these tests read the failure's kind and hold instead. The
// margin follows the shared policy (owner decision E3): a tenth of the lifetime, at least 5 s.
import { describe, expect, it } from "vitest"
import {
  clientCredentialsTokens,
  type ClientCredentialsOptions,
  memoryTokenStore,
  tokenKey,
  type TokenRecord,
  type TokenStore,
} from "../../src/oauth/index.js"
import { jsonAnswer } from "../fake-fetch.js"
import { failureOf, TOKEN_URL, TokenServer } from "./support.js"

const ENDPOINT = {
  url: TOKEN_URL,
  clientId: "pulse",
  clientSecret: "s3cret",
  clientAuth: "post",
} as const
const GRANT = {
  type: "client_credentials",
  audience: "zeebe.camunda.io",
  scopes: ["read", "more"],
} as const
const LIFETIME_S = 3600
const STEP_BACK_MS = 10 * 60 * 1000

function tokensOf(server: TokenServer, overrides: Partial<ClientCredentialsOptions> = {}) {
  return clientCredentialsTokens({
    endpoint: ENDPOINT,
    grant: GRANT,
    platform: server.platform,
    ...overrides,
  })
}

/** Whether a token read after `waitMs` asks the endpoint again. */
async function asksAgainAfter(
  server: TokenServer,
  tokens: ReturnType<typeof tokensOf>,
  waitMs: number,
) {
  const before = server.requests
  server.clock.now += waitMs
  await tokens.token().catch(() => undefined)
  return server.requests > before
}

describe("client credentials", () => {
  it("ask for a token with the client, the audience and the scopes, never following a redirect", async () => {
    const server = new TokenServer()
    await expect(tokensOf(server).token()).resolves.toBe("token-1")
    expect(Object.fromEntries(server.forms[0] ?? [])).toEqual({
      grant_type: "client_credentials",
      client_id: "pulse",
      client_secret: "s3cret",
      audience: "zeebe.camunda.io",
      scope: "read more",
    })
    expect(server.calls[0]?.redirect).toBe("manual")
  })

  it("send a token with every character the Bearer token syntax allows as it came", async () => {
    const server = new TokenServer()
    server.answer = () => jsonAnswer({ access_token: "eyJ0-9_A.z~Z+a/b==", expires_in: LIFETIME_S })
    await expect(tokensOf(server).token()).resolves.toBe("eyJ0-9_A.z~Z+a/b==")
  })

  it("ask once for parallel reads", async () => {
    const server = new TokenServer()
    const tokens = tokensOf(server)
    await Promise.all([tokens.token(), tokens.token()])
    await tokens.token()
    expect(server.requests).toBe(1)
    expect(tokens.renewable).toBe(true)
  })

  it("ask again shortly before the token expires, not earlier", async () => {
    const server = new TokenServer()
    const tokens = tokensOf(server)
    await tokens.token()
    expect(await asksAgainAfter(server, tokens, (LIFETIME_S - 90) * 1000)).toBe(false)
    expect(await asksAgainAfter(server, tokens, 60 * 1000)).toBe(true)
  })

  it.each([
    [100, 90],
    [20, 15],
  ])("renew a token of %i s at %i s: a tenth before, at least five seconds", async (s, at) => {
    const server = new TokenServer()
    server.answer = () => jsonAnswer({ access_token: "short", expires_in: s })
    const tokens = tokensOf(server)
    await tokens.token()
    expect(await asksAgainAfter(server, tokens, at * 1000 - 1)).toBe(false)
    expect(await asksAgainAfter(server, tokens, 1)).toBe(true)
  })

  it.each([[undefined], [0], [-60], ["0"], ["-60"], ["1e3"], ["soon"], [null], [true]])(
    "assume a lifetime of 300 s when expires_in is %j, so no read asks again at once",
    async (expiresIn) => {
      const server = new TokenServer()
      server.answer = () => jsonAnswer({ access_token: "plain", expires_in: expiresIn })
      const tokens = tokensOf(server)
      await tokens.token()
      await tokens.token()
      expect(await asksAgainAfter(server, tokens, 269 * 1000)).toBe(false)
      expect(await asksAgainAfter(server, tokens, 2 * 1000)).toBe(true)
    },
  )

  it.each([
    ["300", 270],
    ["1200", 1140],
  ])("read expires_in %j as seconds", async (expiresIn, refreshS) => {
    const server = new TokenServer()
    server.answer = () => jsonAnswer({ access_token: "t", expires_in: expiresIn })
    const tokens = tokensOf(server)
    await tokens.token()
    expect(await asksAgainAfter(server, tokens, (refreshS - 1) * 1000)).toBe(false)
    expect(await asksAgainAfter(server, tokens, 2 * 1000)).toBe(true)
  })
})

describe("a refused token request", () => {
  it("stops: it reads as the client's refusal and is not repeated", async () => {
    const server = new TokenServer()
    server.answer = () => jsonAnswer({ error: "unauthorized_client" }, 401)
    const tokens = tokensOf(server)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const failure = await failureOf(tokens.token())
      expect(failure).toMatchObject({ kind: "client", code: "unauthorized_client" })
      expect(failure.message).not.toContain("s3cret")
    }
    expect(server.requests).toBe(1)
  })

  it("is tried again a minute later, or at once by a source with another secret", async () => {
    const server = new TokenServer()
    server.answer = () => jsonAnswer({ error: "unauthorized_client" }, 401)
    const tokens = tokensOf(server)
    await failureOf(tokens.token())
    server.answer = () => jsonAnswer({ access_token: "fixed", expires_in: LIFETIME_S })
    const rotated = tokensOf(server, { endpoint: { ...ENDPOINT, clientSecret: "rotated" } })
    await expect(rotated.token()).resolves.toBe("fixed")
    expect(await asksAgainAfter(server, tokens, 59_999)).toBe(false)
    expect(await asksAgainAfter(server, tokens, 1)).toBe(true)
    await expect(tokens.token()).resolves.toBe("fixed")
  })

  it.each([
    ["an error code", () => jsonAnswer({ error: "invalid_scope" }, 400)],
    ["no error code", () => new Response("", { status: 400 })],
    ["a refused client", () => jsonAnswer({ error: "invalid_client" }, 401)],
    ["a refused client with another code", () => jsonAnswer({ error: "access_denied" }, 401)],
    ["a forbidden client", () => new Response("", { status: 403 })],
    ["a wrong path", () => new Response("", { status: 404 })],
    ["a redirect", () => new Response("", { status: 302 })],
    ["no token", () => jsonAnswer({ token_type: "Bearer" })],
    ["no JSON", () => new Response("<html>")],
    ["a token outside the syntax", () => jsonAnswer({ access_token: "a\nb" })],
    [
      "more than a mebibyte",
      () => new Response("{}", { headers: { "Content-Length": String(1024 * 1024 + 1) } }),
    ],
  ])("holds a refusal with %s for a minute", async (_name, answer) => {
    const server = new TokenServer()
    server.answer = answer
    const tokens = tokensOf(server)
    await failureOf(tokens.token())
    expect(await asksAgainAfter(server, tokens, 59 * 1000)).toBe(false)
    expect(await asksAgainAfter(server, tokens, 2 * 1000)).toBe(true)
  })

  it.each([408, 425, 500, 502, 503, 504])(
    "reads HTTP %i as unavailable and tries again after five seconds",
    async (status) => {
      const server = new TokenServer()
      server.answer = () => new Response(null, { status })
      const tokens = tokensOf(server)
      expect(await failureOf(tokens.token())).toMatchObject({ kind: "unavailable", status })
      expect(await asksAgainAfter(server, tokens, 4 * 1000)).toBe(false)
      expect(await asksAgainAfter(server, tokens, 2 * 1000)).toBe(true)
    },
  )

  it("honours the wait a rate limit asks for, a minute when it names none", async () => {
    const server = new TokenServer()
    server.answer = () => new Response("", { status: 429, headers: { "Retry-After": "120" } })
    const tokens = tokensOf(server)
    expect(await failureOf(tokens.token())).toMatchObject({ kind: "rate-limited" })
    expect(await asksAgainAfter(server, tokens, 100 * 1000)).toBe(false)
    expect(await asksAgainAfter(server, tokens, 21 * 1000)).toBe(true)
    server.answer = () => new Response("", { status: 429 })
    expect(await asksAgainAfter(server, tokens, 121 * 1000)).toBe(true)
    expect(await asksAgainAfter(server, tokens, 59 * 1000)).toBe(false)
    expect(await asksAgainAfter(server, tokens, 2 * 1000)).toBe(true)
  })

  it("reads a login service that cannot be reached as unreachable and holds it five seconds", async () => {
    const server = new TokenServer()
    server.answer = () => {
      throw new TypeError("fetch failed")
    }
    const tokens = tokensOf(server)
    expect(await failureOf(tokens.token())).toMatchObject({ kind: "unreachable" })
    expect(await asksAgainAfter(server, tokens, 4 * 1000)).toBe(false)
    expect(await asksAgainAfter(server, tokens, 2 * 1000)).toBe(true)
  })

  it("is never sent to a URL with a password: the caller's mistake, which holds nothing", async () => {
    const server = new TokenServer()
    const url = "https://pulse:s3cret@login.test/oauth/token"
    const tokens = tokensOf(server, { endpoint: { ...ENDPOINT, url } })
    const refused = new RangeError("the authorization server URL carries a user or a password")
    await expect(tokens.token()).rejects.toThrow(refused)
    await expect(tokens.token()).rejects.toThrow(refused)
    expect(server.requests).toBe(0)
  })
})

describe("an API that rejects a token", () => {
  it("lets the next attempt take a token when none was sent by this source yet", async () => {
    const server = new TokenServer()
    await expect(tokensOf(server).rejected("from elsewhere")).resolves.toBe(true)
    expect(server.requests).toBe(0)
  })

  it("gets one fresh token when the token is old enough to have gone stale", async () => {
    const server = new TokenServer()
    const tokens = tokensOf(server)
    const first = String(await tokens.token())
    server.clock.now += 60 * 1000
    await expect(tokens.rejected(first)).resolves.toBe(true)
    await expect(tokens.token()).resolves.toBe("token-2")
  })

  it("keeps a token it just got, so a wrong audience costs no token per read", async () => {
    const server = new TokenServer()
    const tokens = tokensOf(server)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(tokens.rejected(String(await tokens.token()))).resolves.toBe(false)
    }
    expect(server.requests).toBe(1)
  })

  it("retries with the token another read already fetched", async () => {
    const server = new TokenServer()
    const tokens = tokensOf(server)
    const stale = String(await tokens.token())
    server.clock.now += 60 * 1000
    await tokens.rejected(stale)
    await tokens.token()
    await expect(tokens.rejected(stale)).resolves.toBe(true)
    expect(server.requests).toBe(2)
  })
})

describe("a clock that steps back", () => {
  it("asks for a new token once the clock is behind the token, then keeps that one", async () => {
    const server = new TokenServer()
    const tokens = tokensOf(server)
    await tokens.token()
    server.clock.now -= STEP_BACK_MS
    await expect(tokens.token()).resolves.toBe("token-2")
    await expect(tokens.token()).resolves.toBe("token-2")
  })

  it("gets a fresh token after a 401 when the clock stepped back during the read", async () => {
    const server = new TokenServer()
    const tokens = tokensOf(server)
    const sent = String(await tokens.token())
    server.clock.now -= STEP_BACK_MS
    await expect(tokens.rejected(sent)).resolves.toBe(true)
    await expect(tokens.token()).resolves.toBe("token-2")
  })

  it.each([
    ["a refusal", () => jsonAnswer({ error: "invalid_client" }, 401)],
    ["a rate limit", () => new Response("", { status: 429, headers: { "Retry-After": "3600" } })],
    ["a failing login service", () => new Response("", { status: 503 })],
  ])("ends the hold of %s that began after the clock's new time", async (_name, answer) => {
    const server = new TokenServer()
    server.answer = answer
    const tokens = tokensOf(server)
    await failureOf(tokens.token())
    server.clock.now -= STEP_BACK_MS
    server.answer = () => jsonAnswer({ access_token: "fixed", expires_in: LIFETIME_S })
    await expect(tokens.token()).resolves.toBe("fixed")
  })
})

describe("a store", () => {
  it("keeps the token under the digest of the endpoint, the client, its secret, the audience and the sorted scopes", async () => {
    const server = new TokenServer()
    const keys: string[] = []
    const memory = memoryTokenStore()
    const store: TokenStore = {
      ...memory,
      read: (key) => {
        keys.push(key)
        return memory.read(key)
      },
    }
    await tokensOf(server, { store, grant: { ...GRANT, scopes: ["read", "more"] } }).token()
    const bare = { type: "client_credentials" } as const
    const publicClient = { url: TOKEN_URL, clientId: "pulse", clientAuth: "none" } as const
    await tokensOf(server, { store, endpoint: publicClient, grant: bare }).token()
    expect(keys).toEqual([
      await tokenKey([
        "client_credentials",
        TOKEN_URL,
        "pulse",
        "s3cret",
        "zeebe.camunda.io",
        ["more", "read"],
      ]),
      await tokenKey(["client_credentials", TOKEN_URL, "pulse", null, null, []]),
    ])
  })

  it("lets a source built anew take the token over: one request for every source", async () => {
    const server = new TokenServer()
    const store = memoryTokenStore()
    await Promise.all([tokensOf(server, { store }).token(), tokensOf(server, { store }).token()])
    await expect(tokensOf(server, { store }).token()).resolves.toBe("token-1")
    expect(server.requests).toBe(1)
  })

  it("keeps a token per client, secret, audience and set of scopes", async () => {
    const server = new TokenServer()
    const store = memoryTokenStore()
    await tokensOf(server, { store }).token()
    await tokensOf(server, { store, grant: { ...GRANT, scopes: ["more", "read"] } }).token()
    expect(server.requests).toBe(1)
    const publicClient = { url: TOKEN_URL, clientId: "pulse", clientAuth: "none" } as const
    await tokensOf(server, {
      store,
      endpoint: publicClient,
      grant: { type: "client_credentials" },
    }).token()
    expect(server.requests).toBe(2)
  })

  it("takes over a token whose answer named no lifetime for 270 s, kept without an expiry", async () => {
    const server = new TokenServer()
    server.answer = () => jsonAnswer({ access_token: `plain-${String(server.requests)}` })
    const written: TokenRecord[] = []
    const memory = memoryTokenStore()
    const store: TokenStore = {
      ...memory,
      write: (key, record) => {
        written.push(record)
        return memory.write(key, record)
      },
    }
    await tokensOf(server, { store }).token()
    server.clock.now += 269_999
    await expect(tokensOf(server, { store }).token()).resolves.toBe("plain-1")
    server.clock.now += 1
    await expect(tokensOf(server, { store }).token()).resolves.toBe("plain-2")
    expect(written.map((record) => record.expiresAt)).toEqual([undefined, undefined])
  })

  it("never takes over a token the API refused, nor one that is due", async () => {
    const server = new TokenServer()
    const store: TokenStore = memoryTokenStore()
    const tokens = tokensOf(server, { store })
    const refused = String(await tokens.token())
    server.clock.now += 60 * 1000
    await tokens.rejected(refused)
    await expect(tokens.token()).resolves.toBe("token-2")
    server.clock.now += LIFETIME_S * 1000
    await expect(tokensOf(server, { store }).token()).resolves.toBe("token-3")
  })
})
