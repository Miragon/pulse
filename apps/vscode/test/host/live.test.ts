import { FakeEngine, FakeWorld } from "../../src/contract/fake/index.js"
import { DiagramCache } from "../../src/core/index.js"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { Connection } from "../../src/host/connections/connection.js"
import { EnginesTreeLive, type LiveTree } from "../../src/host/explorer/engines-tree-live.js"
import { LiveTriggers } from "../../src/host/live/live-triggers.js"
import { LiveWiring } from "../../src/host/live/live-wiring.js"
import { WindowAttention } from "../../src/host/live/window-attention.js"
import { ConnectionLive } from "./support/connection-live.js"
import { FakeRegistry } from "./support/fake-registry.js"
import { LOCAL_TARGET } from "../../src/host/connections/engine-target.js"
import {
  EventEmitter,
  debugEnded,
  documentSaved,
  taskEnded,
  window,
  windowStateChanged,
} from "./support/vscode-fake.js"

vi.mock("vscode", () => import("./support/vscode-fake.js"))

const FIFTEEN_MINUTES = 15 * 60_000

function connection(name: string, environment: "local" | "test" = "local"): Connection {
  const runtime = new FakeEngine(FakeWorld.seed().state)
  return {
    target: { ...LOCAL_TARGET, name },
    badge: { name, environment, host: "localhost:8080" },
    runtime,
    diagrams: new DiagramCache(runtime),
    ...ConnectionLive.of(runtime),
  }
}

function changeWindow(state: { focused: boolean; active: boolean }): void {
  window.state = state
  windowStateChanged.fire(state)
}

beforeEach(() => {
  vi.useFakeTimers()
  window.state = { focused: true, active: true }
})

afterEach(() => {
  vi.useRealTimers()
})

describe("the attention of a window", () => {
  test("is hidden, in the background or watched, and idle only after 15 quiet minutes", () => {
    const attention = new WindowAttention()
    const changed = vi.fn()
    attention.onDidChange(changed)

    expect(attention.of(false)).toBe("hidden")
    expect(attention.of(true)).toBe("watched")
    changeWindow({ focused: false, active: true })
    expect(attention.of(true)).toBe("background")

    changeWindow({ focused: true, active: false })
    vi.advanceTimersByTime(FIFTEEN_MINUTES - 1)
    expect(attention.of(true)).toBe("watched")
    vi.advanceTimersByTime(1)
    expect(attention.of(true)).toBe("idle")

    attention.noteActivity()
    expect(attention.of(true)).toBe("watched")
    expect(changed).toHaveBeenCalledTimes(4)
    attention.dispose()
  })

  test("counts input inside a panel as activity that restarts the idle clock", () => {
    const attention = new WindowAttention()
    changeWindow({ focused: true, active: false })
    vi.advanceTimersByTime(FIFTEEN_MINUTES - 1000)
    attention.noteActivity()
    vi.advanceTimersByTime(FIFTEEN_MINUTES - 1000)

    expect(attention.of(true)).toBe("watched")
    attention.dispose()
  })
})

describe("the dev loop triggers", () => {
  test("nudge local engines after a saved model, a debug session or a task, at most every 5 s", () => {
    const local = connection("local")
    const test = connection("test", "test")
    const forgetLocal = vi.spyOn(local.definitions, "forget")
    const forgetTest = vi.spyOn(test.definitions, "forget")
    const target = { nudgeLocal: vi.fn() }
    const triggers = new LiveTriggers(new FakeRegistry([local, test]).asRegistry(), [target])

    documentSaved.fire({ uri: { path: "/shop/notes.md" } })
    documentSaved.fire({ uri: { path: "/shop/order.bpmn" } })
    vi.advanceTimersByTime(1000)
    debugEnded.fire(undefined)
    taskEnded.fire(undefined)
    expect(target.nudgeLocal).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(4000)
    expect(target.nudgeLocal).toHaveBeenCalledTimes(2)
    expect(forgetLocal).toHaveBeenCalledTimes(2)
    expect(forgetTest).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(target.nudgeLocal).toHaveBeenCalledTimes(2)
    triggers.dispose()
  })
})

describe("the live engines tree", () => {
  function treeOf(expanded: boolean) {
    const visibility = new EventEmitter<unknown>()
    const refreshEngine = vi.fn<(connection: Connection) => void>()
    const tree: LiveTree = {
      visible: true,
      onDidChangeVisibility: visibility.event,
      isExpanded: () => expanded,
      refreshEngine,
    }
    return { tree, refreshEngine }
  }

  test("reads an expanded engine every 30 s on a local engine and nothing while collapsed", async () => {
    const engine = connection("local")
    const read = vi.spyOn(engine.definitions, "read")
    const live = new LiveWiring(new WindowAttention(), () => undefined)
    const expanded = treeOf(true)
    const loops = new EnginesTreeLive(new FakeRegistry([engine]).asRegistry(), expanded.tree, live)

    await vi.advanceTimersByTimeAsync(36_000)
    expect(read).toHaveBeenCalledWith(0)
    expect(expanded.refreshEngine).toHaveBeenCalledWith(engine)
    loops.dispose()

    read.mockClear()
    const collapsed = new EnginesTreeLive(
      new FakeRegistry([engine]).asRegistry(),
      treeOf(false).tree,
      live,
    )
    await vi.advanceTimersByTimeAsync(120_000)
    expect(read).not.toHaveBeenCalled()
    collapsed.dispose()
  })
})
