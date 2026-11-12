import { createHash } from "node:crypto"
import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { REFUSED_HOLD_MS, UNAVAILABLE_HOLD_MS } from "../../src/oauth/failure.js"
import { memoryTokenStore, tokenKey, TokenFailure } from "../../src/oauth/index.js"

const RECORD = { accessToken: "a", receivedAt: 1 }

describe("tokenKey", () => {
  it("is the SHA-256 of the identity's JSON, in hex", async () => {
    const identity = ["client_credentials", "https://login.test/token", "pulse", "s3cret"]
    const expected = createHash("sha256").update(JSON.stringify(identity)).digest("hex")
    await expect(tokenKey(identity)).resolves.toBe(expected)
  })

  it("never holds a secret in clear and tells identities apart", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 8 }), fc.string(), async (secret, other) => {
        const key = await tokenKey({ secret })
        expect(key).toMatch(/^[0-9a-f]{64}$/)
        expect(key.includes(secret)).toBe(false)
        if (other !== secret) expect(await tokenKey({ secret: other })).not.toBe(key)
      }),
      { numRuns: 50 },
    )
  })
})

describe("memoryTokenStore", () => {
  it("keeps a record per key", async () => {
    const store = memoryTokenStore()
    await store.write("a", RECORD)
    await expect(store.read("a")).resolves.toEqual(RECORD)
    await expect(store.read("b")).resolves.toBeUndefined()
  })

  it("lets one holder of a key work at a time, also after a holder failed", async () => {
    const store = memoryTokenStore()
    const order: string[] = []
    let release = (): void => undefined
    const first = store.exclusive("k", async () => {
      order.push("first in")
      await new Promise<void>((resolve) => {
        release = resolve
      })
      order.push("first out")
      throw new Error("first failed")
    })
    const second = store.exclusive("k", () => {
      order.push("second")
      return Promise.resolve(2)
    })
    const third = store.exclusive("k", () => {
      order.push("third")
      return Promise.resolve(3)
    })
    const other = store.exclusive("other", () => {
      order.push("other key")
      return Promise.resolve(0)
    })
    await other
    await Promise.resolve()
    release()
    await expect(first).rejects.toThrow("first failed")
    await expect(second).resolves.toBe(2)
    await expect(third).resolves.toBe(3)
    expect(order).toEqual(["first in", "other key", "first out", "second", "third"])
    // The queue is gone once every holder ended: a new holder starts at once.
    await expect(store.exclusive("k", () => Promise.resolve("again"))).resolves.toBe("again")
  })
})

describe("TokenFailure", () => {
  it("names its kind, its status and its code, never the server's text", () => {
    const failure = new TokenFailure("grant", {
      status: 400,
      error: "invalid_grant",
      description: "the session of s3cret ended",
    })
    expect(failure.name).toBe("TokenFailure")
    expect(failure.message).toBe("no token: grant (HTTP 400) (invalid_grant)")
    expect(failure.message).not.toContain("s3cret")
    expect(new TokenFailure("expired").message).toBe("no token: expired")
  })

  it("keeps a code of at most 64 code characters, none when nothing is left", () => {
    expect(new TokenFailure("grant", { error: "x".repeat(100) }).code).toBe("x".repeat(64))
    expect(new TokenFailure("grant", { error: "<>  " }).code).toBeUndefined()
    expect(new TokenFailure("grant").code).toBeUndefined()
  })

  it("holds a passing failure five seconds, any other a minute, unless told otherwise", () => {
    for (const kind of ["unavailable", "unreachable", "timeout"] as const) {
      expect(new TokenFailure(kind).holdMs).toBe(UNAVAILABLE_HOLD_MS)
    }
    for (const kind of ["client", "redirect", "rate-limited", "expired"] as const) {
      expect(new TokenFailure(kind).holdMs).toBe(REFUSED_HOLD_MS)
    }
    expect(new TokenFailure("rate-limited", { holdMs: 7 }).holdMs).toBe(7)
    expect([UNAVAILABLE_HOLD_MS, REFUSED_HOLD_MS]).toEqual([5_000, 60_000])
  })

  it("keeps its cause and what it was told", () => {
    const cause = new Error("below")
    const failure = new TokenFailure(
      "unexpected",
      { statusText: "OK", problem: "token-type", tokenType: "DPoP", recordedAt: 3 },
      cause,
    )
    expect(failure).toMatchObject({
      cause,
      statusText: "OK",
      problem: "token-type",
      tokenType: "DPoP",
      recordedAt: 3,
    })
    expect("cause" in new TokenFailure("client")).toBe(false)
    expect(new TokenFailure("unreachable", { url: "https://as/t" }).url).toBe("https://as/t")
  })
})
