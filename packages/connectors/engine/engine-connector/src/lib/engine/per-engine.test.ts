import { describe, expect, it } from "vitest"
import type { Client } from "@miragon/pulse-c7-client"
import { runWithMcpRequestInfo } from "@miragon/pulse-widget-shell/server"
import { EngineRequestError } from "./engine-error.js"
import {
  createCallerCache,
  createHeldCache,
  createOwnerCache,
  dropAfterWrite,
  oneAtATime,
} from "./per-engine.js"

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

/** `call` as the caller `user`, signed in with a token of its own. */
const as = <T>(user: string, call: () => Promise<T>) =>
  runWithMcpRequestInfo({ authUserId: user, authorization: `Bearer ${user}` }, call)

describe("createCallerCache", () => {
  it("answers from one read until its TTL runs out, then reads again", async () => {
    let clock = 0
    const cache = createCallerCache<number>({
      maxEntries: 8,
      maxCallers: 4,
      ttlMs: 1000,
      now: () => clock,
    })
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
    const cache = createCallerCache<number>({ maxEntries: 8, maxCallers: 4, now: () => clock })
    const client = engineClient()
    let reads = 0
    await cache(client, "a", () => Promise.resolve(++reads))
    clock = Number.MAX_SAFE_INTEGER
    expect(await cache(client, "a", () => Promise.resolve(++reads))).toBe(1)
  })
})

describe("createOwnerCache", () => {
  it("keeps reads apart per owner object", async () => {
    const cache = createOwnerCache<string>({ maxEntries: 8, maxCallers: 4 })
    const [first, second] = [{}, {}]
    expect(await cache(first, "a", () => Promise.resolve("first"))).toBe("first")
    expect(await cache(second, "a", () => Promise.resolve("second"))).toBe("second")
    expect(await cache(first, "a", () => Promise.resolve("again"))).toBe("first")
  })

  it("answers the calls that shared a value `keep` refuses, then reads again", async () => {
    const cache = createOwnerCache<number>({
      maxEntries: 8,
      maxCallers: 4,
      keep: (value) => value > 1,
    })
    const owner = {}
    let reads = 0
    const read = () => Promise.resolve(++reads)
    const [shared, joined] = [cache(owner, "a", read), cache(owner, "a", read)]
    expect([await shared, await joined]).toEqual([1, 1])
    expect(await cache(owner, "a", read)).toBe(2)
    expect(await cache(owner, "a", read)).toBe(2)
  })
})

describe("createOwnerCache: bounds per caller", () => {
  /** A cache whose reads count per id, so a read again names the id with a higher count. */
  function counted(options: { maxEntries: number; maxCallers: number }) {
    const cache = createOwnerCache<string>(options)
    const reads = new Map<string, number>()
    const read = (id: string) => () => {
      reads.set(id, (reads.get(id) ?? 0) + 1)
      return Promise.resolve(`${id}#${String(reads.get(id))}`)
    }
    return (owner: object, ...ids: string[]) =>
      Promise.all(ids.map((id) => cache(owner, id, read(id))))
  }

  it("keeps a caller's entries however many another caller reads", async () => {
    const read = counted({ maxEntries: 2, maxCallers: 4 })
    const owner = {}
    expect(await as("ada", () => read(owner, "a", "b"))).toEqual(["a#1", "b#1"])
    // Bob reads past his bound: his least recently used goes, never one of Ada's.
    await as("bob", () => read(owner, "c", "d", "e"))
    expect(await as("ada", () => read(owner, "a", "b"))).toEqual(["a#1", "b#1"])
    expect(await as("bob", () => read(owner, "d", "e", "c"))).toEqual(["d#1", "e#1", "c#2"])
  })

  it("drops every entry of the least recently active caller past the callers it keeps", async () => {
    const read = counted({ maxEntries: 2, maxCallers: 2 })
    const owner = {}
    await as("ada", () => read(owner, "a", "b"))
    await as("bob", () => read(owner, "c"))
    await as("ada", () => read(owner, "a"))
    // A third caller: Bob was the least recently active, so his entries go, Ada's stay.
    await as("cy", () => read(owner, "d"))
    expect(await as("ada", () => read(owner, "a", "b"))).toEqual(["a#1", "b#1"])
    expect(await as("bob", () => read(owner, "c"))).toEqual(["c#2"])
  })

  it("counts a caller towards the callers it keeps only once it holds an answer", async () => {
    const cache = createOwnerCache<string>({
      maxEntries: 8,
      maxCallers: 32,
      keep: (value) => value !== "refused",
    })
    const owner = {}
    let reads = 0
    const read = () => {
      reads++
      return Promise.resolve("a")
    }
    await as("ada", () => cache(owner, "a", read))
    // 32 callers with a token of their own whose reads fail (an engine that refuses them) or
    // answer what `keep` refuses: none holds an answer, so none takes Ada's place.
    for (let junk = 0; junk < 32; junk++) {
      const answer = () =>
        junk % 2 === 0 ? Promise.reject(new Error("401")) : Promise.resolve("refused")
      await as(`junk-${String(junk)}`, () => cache(owner, "a", answer)).catch(() => undefined)
    }
    await as("ada", () => cache(owner, "a", read))
    expect(reads).toBe(1)
  })

  it("keeps the owner's whole bound for the one caller of the calls that send no token", async () => {
    const read = counted({ maxEntries: 2, maxCallers: 3 })
    const owner = {}
    const ids = ["a", "b", "c", "d", "e", "f"]
    await read(owner, ...ids)
    expect(await read(owner, ...ids)).toEqual(ids.map((id) => `${id}#1`))
    await read(owner, "g")
    expect(await read(owner, "a")).toEqual(["a#2"])
  })
})

describe("createOwnerCache: a value's age", () => {
  it("runs the TTL from the oldest read a value holds once it answered", async () => {
    let clock = 500
    const cache = createOwnerCache<{ readAt: number }>({
      maxEntries: 8,
      maxCallers: 4,
      ttlMs: 1000,
      now: () => clock,
      readAt: (value) => value.readAt,
    })
    const owner = {}
    let reads = 0
    // Built at 500 on a read kept since 0: it ages from 0, never from 500.
    const read = () => Promise.resolve({ readAt: reads++ === 0 ? 0 : clock })
    const first = await cache(owner, "a", read)
    clock = 999
    expect(await cache(owner, "a", read)).toBe(first)
    clock = 1000
    expect(await cache(owner, "a", read)).not.toBe(first)
  })
})

describe("dropAfterWrite", () => {
  it("drops every caller's entries of the written engine in the caches made to drop them", async () => {
    const dropped = createOwnerCache<number>({ maxEntries: 8, maxCallers: 4, dropOnWrite: true })
    const kept = createOwnerCache<number>({ maxEntries: 8, maxCallers: 4 })
    const [written, other] = [{}, {}]
    let reads = 0
    const read = () => Promise.resolve(++reads)
    const cases = [
      [dropped, written, "ada"],
      [dropped, written, "bob"],
      [dropped, other, "ada"],
      [kept, written, "ada"],
    ] as const
    const call = () =>
      Promise.all(cases.map(([cache, owner, user]) => as(user, () => cache(owner, "a", read))))
    expect(await call()).toEqual([1, 2, 3, 4])
    dropAfterWrite(written)
    // Both callers of the written engine read anew; another engine and another cache keep theirs.
    expect(await call()).toEqual([5, 6, 3, 4])
  })

  it("keeps no read that was in flight at the write, though it answers its callers", async () => {
    const cache = createOwnerCache<number>({ maxEntries: 8, maxCallers: 4, dropOnWrite: true })
    const owner = {}
    const open = deferred()
    let reads = 0
    const read = async () => {
      const n = ++reads
      if (n === 1) await open.promise
      return n
    }
    const before = cache(owner, "a", read)
    dropAfterWrite(owner)
    open.resolve()
    expect(await before).toBe(1)
    expect(await cache(owner, "a", read)).toBe(2)
  })
})

describe("createHeldCache", () => {
  /** A read the test answers: how often it was asked, and the answer of each ask. */
  function reads() {
    const asked: ReturnType<typeof deferred>[] = []
    const read = async () => {
      const answer = deferred()
      asked.push(answer)
      await answer.promise
      return asked.length
    }
    return { asked, read }
  }

  it("takes a released read off the cache: the next call reads anew, a sharer still waits on it, its answer is kept nowhere", async () => {
    const cache = createHeldCache<number>({ maxEntries: 8, maxCallers: 4 })
    const owner = {}
    const { asked, read } = reads()
    const cut = cache(owner, "a", read)
    const sharer = cache(owner, "a", read)
    cut.release()
    const next = cache(owner, "a", read)
    expect(asked).toHaveLength(2)

    asked[0]?.resolve()
    asked[1]?.resolve()
    expect([await cut.read, await sharer.read, await next.read]).toEqual([2, 2, 2])
    expect(await cache(owner, "a", read).read).toBe(2)
    expect(asked).toHaveLength(2)
  })

  it("leaves a newer read in place when a call releases one the cache no longer holds", async () => {
    const cache = createHeldCache<number>({ maxEntries: 8, maxCallers: 4 })
    const owner = {}
    const { asked, read } = reads()
    const first = cache(owner, "a", read)
    const sharer = cache(owner, "a", read)
    first.release()
    const second = cache(owner, "a", read)
    sharer.release()
    first.release()
    asked.forEach((answer) => answer.resolve())
    expect(await second.read).toBe(2)
    expect(await cache(owner, "a", read).read).toBe(2)
    expect(asked).toHaveLength(2)
  })

  it("releases the read a sharer took again after the call that started its first was cancelled", async () => {
    const cache = createHeldCache<number>({ maxEntries: 8, maxCallers: 4 })
    const owner = {}
    const { asked, read } = reads()
    const leaving = cache(owner, "a", () =>
      Promise.reject(
        new EngineRequestError("cancelled", {
          kind: "cancelled",
          engineMessage: "the caller went away",
          engineId: "e",
        }),
      ),
    )
    const sharer = cache(owner, "a", read)
    await expect(leaving.read).rejects.toMatchObject({ kind: "cancelled" })
    await tick()
    expect(asked).toHaveLength(1)

    sharer.release()
    const next = cache(owner, "a", read)
    expect(asked).toHaveLength(2)
    asked.forEach((answer) => answer.resolve())
    expect([await sharer.read, await next.read]).toEqual([2, 2])
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
