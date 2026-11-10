import { expect, it } from "vitest"
import { memoryTokenStore, refreshingTokens, type TokenStore } from "../../src/oauth/index.js"
import { T0, TOKEN_URL, TokenServer } from "./support.js"

it("asks an endpoint function under the lock, after the store's reading", async () => {
  const server = new TokenServer()
  const memory = memoryTokenStore()
  await memory.write("login", {
    accessToken: "cached-access",
    receivedAt: T0,
    expiresAt: T0 + 300_000,
    refreshToken: "cached-refresh",
  })
  const log: string[] = []
  const store: TokenStore = {
    read: (key) => {
      log.push("read")
      return memory.read(key)
    },
    write: (key, record) => memory.write(key, record),
    exclusive: (key, work) => {
      log.push("lock")
      return memory.exclusive(key, work)
    },
  }
  // A store that keeps the endpoint with the login (the CLI's cache files) reads it there.
  const endpoint = () => {
    log.push("endpoint")
    return { url: `${TOKEN_URL}/v2`, clientId: "pulse-cli", clientAuth: "none" } as const
  }
  server.clock.now = T0 + 270_000
  const tokens = refreshingTokens({ endpoint, key: "login", store, platform: server.platform })
  await expect(tokens.token()).resolves.toBe("token-1")
  expect(log).toEqual(["read", "lock", "read", "endpoint"])
  expect(server.calls[0]?.url).toBe(`${TOKEN_URL}/v2`)
})
