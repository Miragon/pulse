import { describe, expect, it } from "vitest"
import type { Client } from "@miragon/pulse-c7-client"
import { createCallerCache, createOwnerCache, oneAtATime } from "./per-engine.js"

// A stand-in engine client: what the module keeps per engine keys on its interceptors.
const engineClient = () => ({ interceptors: {} }) as unknown as Client

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("createCallerCache", () => {
  it("answers from one read until its TTL runs out, then reads again", async () => {
    let clock = 0
    const cache = createCallerCache<number>({ maxEntries: 8, ttlMs: 1000, now: () => clock })
    const client = engineClient()
    let reads = 0
    const read = () => Promise.resolve(++reads)

    expect(await cache(client, "a", read)).toBe(1)
    clock = 999
    expect(await cache(client, "a", read)).toBe(1)
    clock = 1000
    expect(await cache(client, "a", read)).toBe(2)
  })

  it("keeps an entry for good without a TTL", async () => {
    let clock = 0
    const cache = createCallerCache<number>({ maxEntries: 8, now: () => clock })
    const client = engineClient()
    let reads = 0
    await cache(client, "a", () => Promise.resolve(++reads))
    clock = Number.MAX_SAFE_INTEGER
    expect(await cache(client, "a", () => Promise.resolve(++reads))).toBe(1)
  })
})

describe("createOwnerCache", () => {
  it("keeps reads apart per owner object", async () => {
    const cache = createOwnerCache<string>({ maxEntries: 8 })
    const [first, second] = [{}, {}]
    expect(await cache(first, "a", () => Promise.resolve("first"))).toBe("first")
    expect(await cache(second, "a", () => Promise.resolve("second"))).toBe("second")
    expect(await cache(first, "a", () => Promise.resolve("again"))).toBe("first")
  })

  it("answers the calls that shared a value `keep` refuses, then reads again", async () => {
    const cache = createOwnerCache<number>({ maxEntries: 8, keep: (value) => value > 1 })
    const owner = {}
    let reads = 0
    const read = () => Promise.resolve(++reads)
    const [shared, joined] = [cache(owner, "a", read), cache(owner, "a", read)]
    expect([await shared, await joined]).toEqual([1, 1])
    expect(await cache(owner, "a", read)).toBe(2)
    expect(await cache(owner, "a", read)).toBe(2)
  })
})

describe("oneAtATime", () => {
  it("starts a read on an engine only once the one before it has settled, failed included", async () => {
    const client = engineClient()
    const first = deferred()
    const second = deferred()
    const started: string[] = []
    const a = oneAtATime(client, () => (started.push("a"), first.promise))
    const b = oneAtATime(client, () => (started.push("b"), second.promise))
    const c = oneAtATime(client, () => (started.push("c"), Promise.resolve()))

    await tick()
    expect(started).toEqual(["a"])
    first.reject(new Error("timeout"))
    await expect(a).rejects.toThrow("timeout")
    await tick()
    expect(started).toEqual(["a", "b"])
    second.resolve()
    await b
    await c
    expect(started).toEqual(["a", "b", "c"])
  })

  it("lets two engines read at the same time", async () => {
    const held = deferred()
    const started: string[] = []
    void oneAtATime(engineClient(), () => (started.push("one"), held.promise))
    void oneAtATime(engineClient(), () => (started.push("other"), Promise.resolve()))

    await tick()
    expect(started).toEqual(["one", "other"])
    held.resolve()
  })
})
