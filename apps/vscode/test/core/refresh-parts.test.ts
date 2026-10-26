import type { DefinitionSummary } from "../../src/contract/index.js"
import { describe, expect, test, vi } from "vitest"
import { EngineLane } from "../../src/core/refresh/engine-lane.js"
import { RefreshCadence } from "../../src/core/refresh/refresh-cadence.js"
import { SharedDefinitions } from "../../src/core/refresh/shared-definitions.js"

const SOMETIMES = () => 0.5

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe("the refresh cadence", () => {
  test("reads local engines faster than test engines, and production slowest", () => {
    expect(RefreshCadence.intervalMs("instance", "local")).toBe(5000)
    expect(RefreshCadence.intervalMs("definition", "test")).toBe(30_000)
    expect(RefreshCadence.intervalMs("engine", "production")).toBe(60_000)
    expect(RefreshCadence.intervalMs("tree", "production")).toBe(120_000)
  })

  test("treats an unclassified engine like production", () => {
    expect(RefreshCadence.intervalMs("instance", "unclassified")).toBe(
      RefreshCadence.intervalMs("instance", "production"),
    )
  })

  test("waits at least four times as long as the last load took, with ±20 % jitter", () => {
    expect(RefreshCadence.nextMs(10_000, 1000, SOMETIMES)).toBe(10_000)
    expect(RefreshCadence.nextMs(10_000, 5000, SOMETIMES)).toBe(20_000)
    expect(RefreshCadence.nextMs(10_000, 0, () => 0)).toBe(8000)
    expect(RefreshCadence.nextMs(10_000, 0, () => 1)).toBe(12_000)
  })

  test("backs off exponentially, never below the interval, capped per environment", () => {
    expect(RefreshCadence.backoffMs(5000, 1, "local", () => 1)).toBe(10_000)
    expect(RefreshCadence.backoffMs(5000, 2, "local", () => 1)).toBe(20_000)
    expect(RefreshCadence.backoffMs(5000, 9, "local", () => 1)).toBe(30_000)
    expect(RefreshCadence.backoffMs(5000, 1, "local", () => 0)).toBe(5000)
    expect(RefreshCadence.backoffMs(60_000, 9, "production", () => 1)).toBe(900_000)
    expect(RefreshCadence.backoffMs(15_000, 9, "test", () => 1)).toBe(300_000)
  })

  test("spreads a catch-up over at most two seconds", () => {
    expect(RefreshCadence.catchUpMs(() => 0)).toBe(0)
    expect(RefreshCadence.catchUpMs(() => 1)).toBe(2000)
  })

  test("reads history every fourth tick, never on production", () => {
    expect([1, 2, 3, 4, 8].map((tick) => RefreshCadence.readsHistory(tick, "local"))).toEqual([
      false,
      false,
      false,
      true,
      true,
    ])
    expect(RefreshCadence.readsHistory(4, "test")).toBe(true)
    expect(RefreshCadence.readsHistory(4, "production")).toBe(false)
    expect(RefreshCadence.readsHistory(4, "unclassified")).toBe(false)
  })

  test("rounds seconds for the stamp and never shows zero", () => {
    expect(RefreshCadence.seconds(10_400)).toBe(10)
    expect(RefreshCadence.seconds(200)).toBe(1)
  })
})

describe("the engine lane", () => {
  test("lets a tick through only while nothing else runs", async () => {
    const lane = new EngineLane()
    const first = deferred<string>()
    const running = lane.run(() => first.promise)

    expect(await lane.tryRun(() => Promise.resolve("tick"))).toBeUndefined()
    first.resolve("first")
    expect(await running).toBe("first")
    expect(await lane.tryRun(() => Promise.resolve("tick"))).toBe("tick")
  })

  test("queues waiting loads in order and hands over without a gap", async () => {
    const lane = new EngineLane()
    const order: string[] = []
    const first = deferred<undefined>()
    const one = lane.run(async () => {
      await first.promise
      order.push("one")
    })
    const two = lane.run(() => {
      order.push("two")
      return Promise.resolve()
    })
    first.resolve(undefined)
    await Promise.resolve()

    expect(await lane.tryRun(() => Promise.resolve("tick"))).toBeUndefined()
    await Promise.all([one, two])
    expect(order).toEqual(["one", "two"])
  })

  test("releases the lane when a load fails", async () => {
    const lane = new EngineLane()
    await expect(lane.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom")
    expect(await lane.tryRun(() => Promise.resolve("tick"))).toBe("tick")
  })

  test("refuses ticks while blocked, until unblocked", async () => {
    const lane = new EngineLane()
    lane.block()
    expect(lane.isBlocked).toBe(true)
    expect(await lane.tryRun(() => Promise.resolve("tick"))).toBeUndefined()
    lane.unblock()
    expect(await lane.tryRun(() => Promise.resolve("tick"))).toBe("tick")
  })
})

describe("shared definitions", () => {
  const SUMMARIES: readonly DefinitionSummary[] = []

  test("joins a read in flight instead of starting a second one", async () => {
    const reading = deferred<readonly DefinitionSummary[]>()
    const listDefinitions = vi.fn(() => reading.promise)
    const shared = new SharedDefinitions({ listDefinitions }, new EngineLane(), () => 0)

    const first = shared.read(0)
    const second = shared.read(0)
    reading.resolve(SUMMARIES)

    expect(await first).toBe(await second)
    expect(listDefinitions).toHaveBeenCalledTimes(1)
  })

  test("reuses a result younger than the allowed age and reads again after it", async () => {
    let now = 0
    const listDefinitions = vi.fn(() => Promise.resolve(SUMMARIES))
    const shared = new SharedDefinitions({ listDefinitions }, new EngineLane(), () => now)
    await shared.read(0)
    now = 4000
    await shared.listDefinitions()
    expect(listDefinitions).toHaveBeenCalledTimes(1)
    now = 6000
    await shared.listDefinitions()
    expect(listDefinitions).toHaveBeenCalledTimes(2)
  })

  test("tells a listener that subscribes again while being told only once", async () => {
    const shared = new SharedDefinitions(
      { listDefinitions: () => Promise.resolve(SUMMARIES) },
      new EngineLane(),
      () => 0,
    )
    let told = 0
    let unsubscribe = (): void => undefined
    const listen = (): void => {
      told += 1
      unsubscribe()
      unsubscribe = shared.subscribe(listen)
    }
    unsubscribe = shared.subscribe(listen)

    await shared.read(0)

    expect(told).toBe(1)
  })

  test("measures the age from the answer, so a slow read is not read again at once", async () => {
    let now = 0
    const listDefinitions = vi.fn(() => {
      now += 6000
      return Promise.resolve(SUMMARIES)
    })
    const shared = new SharedDefinitions({ listDefinitions }, new EngineLane(), () => now)
    let told = 0
    shared.subscribe(() => {
      told += 1
      void shared.read(5000)
    })

    await shared.read(5000)
    await Promise.resolve()

    expect(listDefinitions).toHaveBeenCalledTimes(1)
    expect(told).toBe(1)
  })

  test("forgets a settled result and tells subscribers about new results and forgetting", async () => {
    const listDefinitions = vi.fn(() => Promise.resolve(SUMMARIES))
    const shared = new SharedDefinitions({ listDefinitions }, new EngineLane(), () => 0)
    const listener = vi.fn()
    const unsubscribe = shared.subscribe(listener)

    await shared.read(60_000)
    await shared.read(60_000)
    shared.forget()
    await shared.read(60_000)
    unsubscribe()
    shared.forget()
    await shared.read(60_000)

    expect(listDefinitions).toHaveBeenCalledTimes(3)
    expect(listener).toHaveBeenCalledTimes(3)
  })
})
