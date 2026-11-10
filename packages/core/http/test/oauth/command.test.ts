import { describe, expect, it } from "vitest"
import {
  type CommandOptions,
  commandTokens,
  memoryTokenStore,
  type TokenStore,
} from "../../src/oauth/index.js"
import { T0 } from "./support.js"

const segment = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, "")
/** A JWT that expires `seconds` after T0. */
const jwt = (id: string, seconds: number) =>
  `${segment({ alg: "none" })}.${segment({ sub: id, exp: T0 / 1000 + seconds })}.sig`

function setup(printed: readonly string[], options: Partial<CommandOptions> = {}) {
  const clock = { now: T0 }
  let runs = 0
  const run = () => {
    const token = printed[Math.min(runs, printed.length - 1)] ?? ""
    runs += 1
    return Promise.resolve(token)
  }
  const tokens = (overrides: Partial<CommandOptions> = {}) =>
    commandTokens(run, {
      key: "command",
      now: () => clock.now,
      ...options,
      ...overrides,
    })
  return { clock, tokens, runs: () => runs }
}

describe("a token command", () => {
  it("runs once while its JWT is fresh, and again shortly before it expires", async () => {
    const test = setup([jwt("a", 300), jwt("b", 600)])
    const tokens = test.tokens()
    await expect(tokens.token()).resolves.toBe(jwt("a", 300))
    test.clock.now = T0 + 269_999
    await tokens.token()
    expect(test.runs()).toBe(1)
    test.clock.now = T0 + 270_000
    await expect(tokens.token()).resolves.toBe(jwt("b", 600))
    expect(tokens.renewable).toBe(true)
  })

  it("renews an opaque token after the default lifetime, or by the expiry a caller reads", async () => {
    const test = setup(["opaque-1", "opaque-2"])
    const tokens = test.tokens()
    await tokens.token()
    test.clock.now = T0 + 270_000
    await expect(tokens.token()).resolves.toBe("opaque-2")
    const read = setup(["opaque-1", "opaque-2"], { expiryOf: () => T0 + 10_000 })
    const short = read.tokens()
    await short.token()
    read.clock.now = T0 + 5_000
    await expect(short.token()).resolves.toBe("opaque-2")
  })

  it("keeps a token of known expiry in the store for the next source, never an opaque one", async () => {
    const store = memoryTokenStore()
    const test = setup([jwt("a", 300), jwt("b", 300)], { store })
    await test.tokens().token()
    await expect(test.tokens().token()).resolves.toBe(jwt("a", 300))
    expect(test.runs()).toBe(1)
    const opaque = setup(["opaque-1", "opaque-2"], { store: memoryTokenStore(), key: "other" })
    await opaque.tokens().token()
    await expect(opaque.tokens().token()).resolves.toBe("opaque-2")
    const exp = setup([`${segment({})}.${segment({ sub: "x" })}.s`], { store })
    await exp.tokens({ key: "no-exp" }).token()
    await expect(store.read("no-exp")).resolves.toBeUndefined()
  })

  it("runs again after a 401 for an old enough token; true only for another token", async () => {
    const test = setup([jwt("a", 3600), jwt("b", 3600), jwt("b", 3600)])
    const tokens = test.tokens()
    const sent = String(await tokens.token())
    await expect(tokens.rejected(sent)).resolves.toBe(false)
    test.clock.now = T0 + 30_000
    await expect(tokens.rejected(sent)).resolves.toBe(true)
    await expect(tokens.token()).resolves.toBe(jwt("b", 3600))
    test.clock.now = T0 + 60_000
    await expect(tokens.rejected(jwt("b", 3600))).resolves.toBe(false)
    await expect(tokens.rejected("an older one")).resolves.toBe(true)
    expect(test.runs()).toBe(3)
  })

  it("sends the token a 401 brought once as it is, even one due at once, then runs again", async () => {
    const test = setup([jwt("a", 3600), jwt("b", 35), jwt("c", 3600)])
    const tokens = test.tokens()
    const sent = String(await tokens.token())
    test.clock.now = T0 + 30_000
    await expect(tokens.rejected(sent)).resolves.toBe(true)
    await expect(tokens.token()).resolves.toBe(jwt("b", 35))
    expect(test.runs()).toBe(2)
    await expect(tokens.token()).resolves.toBe(jwt("c", 3600))
  })

  it("runs again when the token a 401 brought expired before it went out", async () => {
    const test = setup([jwt("a", 3600), jwt("b", 31), jwt("c", 3600)])
    const tokens = test.tokens()
    const sent = String(await tokens.token())
    test.clock.now = T0 + 30_000
    await tokens.rejected(sent)
    test.clock.now = T0 + 31_000
    await expect(tokens.token()).resolves.toBe(jwt("c", 3600))
  })

  it("lets the next attempt run the command when this source sent no token yet", async () => {
    const test = setup(["a"])
    await expect(test.tokens().rejected("from elsewhere")).resolves.toBe(true)
    expect(test.runs()).toBe(0)
  })

  it("takes another process's token after a 401, never the one refused", async () => {
    const store: TokenStore = memoryTokenStore()
    const test = setup([jwt("a", 3600), jwt("c", 3600)], { store })
    const tokens = test.tokens()
    const sent = String(await tokens.token())
    test.clock.now = T0 + 30_000
    await store.write("command", {
      accessToken: "from-another",
      receivedAt: T0,
      expiresAt: T0 + 3_600_000,
    })
    await expect(tokens.rejected(sent)).resolves.toBe(true)
    await expect(tokens.token()).resolves.toBe("from-another")
    test.clock.now = T0 + 60_000
    await expect(tokens.rejected("from-another")).resolves.toBe(true)
    await expect(tokens.token()).resolves.toBe(jwt("c", 3600))
  })
})
