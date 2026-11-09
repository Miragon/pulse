import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { FakeEngine, FakeWorld } from "@miragon/pulse-runtime-view/contract/fake"
import { type Connection, LOCAL_TARGET } from "@miragon/pulse-runtime-view/host-kit"
import type { EngineRegistry } from "../src/worker/engine-registry.js"
import { EnginesLive } from "../src/worker/engines-live.js"
import { OrcaLive } from "../src/worker/orca-live.js"
import { ConnectionLive } from "./connection-live.js"

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

class Registry {
  readonly connections: Connection[] = []
  private readonly listeners: (() => void)[] = []

  add(name: string, environment: string): Connection {
    const runtime = new FakeEngine(FakeWorld.seed().state)
    const connection = {
      target: { ...LOCAL_TARGET, name },
      badge: { name, environment, host: "localhost:8080" },
      runtime,
      ...ConnectionLive.of(runtime),
    } as unknown as Connection
    this.connections.push(connection)
    return connection
  }

  change(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  asRegistry(): EngineRegistry {
    return {
      all: () => this.connections,
      onDidChange: (listener: () => void) => {
        this.listeners.push(listener)
        return () => undefined
      },
    } as unknown as EngineRegistry
  }
}

describe("the worker's attention", () => {
  test("is hidden without a visible surface and idle after fifteen quiet minutes", () => {
    const live = new OrcaLive(() => undefined)
    const changes = vi.fn()
    live.onDidChange(changes)

    expect(live.of(false)).toBe("hidden")
    expect(live.of(true)).toBe("watched")
    vi.advanceTimersByTime(15 * 60_000)
    expect(live.of(true)).toBe("idle")
    live.noteActivity()

    expect(live.of(true)).toBe("watched")
    expect(changes).toHaveBeenCalledTimes(2)
    live.dispose()
  })

  test("stops telling a listener that left", () => {
    const live = new OrcaLive(() => undefined)
    const changes = vi.fn()
    const leave = live.onDidChange(changes)

    leave()
    vi.advanceTimersByTime(15 * 60_000)

    expect(changes).not.toHaveBeenCalled()
  })

  test("logs the live updates of an engine under its name", () => {
    const lines: string[] = []
    const live = new OrcaLive((line) => lines.push(line))
    const connection = new Registry().add("shop", "local")

    live.contextFor(connection).log("paused")

    expect(lines).toEqual(["shop: paused"])
  })
})

describe("the live engines tree", () => {
  test("refreshes the processes of every engine while the panel is visible", async () => {
    const registry = new Registry()
    const local = registry.add("shop-dev", "local")
    const refreshed = vi.fn()
    const live = new EnginesLive(registry.asRegistry(), new OrcaLive(() => undefined), refreshed)
    registry.change()

    live.show(true)
    await vi.advanceTimersByTimeAsync(60_000)

    expect(refreshed).toHaveBeenCalledWith(local)
    live.dispose()
  })

  test("refreshes a local engine at once after a saved model", async () => {
    const registry = new Registry()
    const local = registry.add("shop-dev", "local")
    registry.add("prod-eu", "production")
    const refreshed = vi.fn()
    const live = new EnginesLive(registry.asRegistry(), new OrcaLive(() => undefined), refreshed)
    registry.change()
    live.show(true)
    await vi.advanceTimersByTimeAsync(60_000)
    refreshed.mockClear()

    live.nudgeLocal()
    await vi.advanceTimersByTimeAsync(2000)

    expect(refreshed).toHaveBeenCalledWith(local)
    live.dispose()
  })

  test("refreshes nothing while the panel is hidden", async () => {
    const registry = new Registry()
    registry.add("shop-dev", "local")
    const refreshed = vi.fn()
    const live = new EnginesLive(registry.asRegistry(), new OrcaLive(() => undefined), refreshed)
    registry.change()

    live.show(false)
    await vi.advanceTimersByTimeAsync(60_000)

    expect(refreshed).not.toHaveBeenCalled()
  })

  test("follows the worker going idle", async () => {
    const registry = new Registry()
    registry.add("shop-dev", "local")
    const refreshed = vi.fn()
    const live = new EnginesLive(registry.asRegistry(), new OrcaLive(() => undefined), refreshed)
    registry.change()
    live.show(true)

    await vi.advanceTimersByTimeAsync(16 * 60_000)
    refreshed.mockClear()
    await vi.advanceTimersByTimeAsync(30_000)

    expect(refreshed.mock.calls.length).toBeLessThanOrEqual(1)
    live.dispose()
  })
})
