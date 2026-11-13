import { afterEach, describe, expect, test, vi } from "vitest"
import type { Attention, Panel, PanelContext } from "@miragon/pulse-runtime-view/core"
import type { PanelState, WebviewIntent } from "@miragon/pulse-runtime-view/protocol"
import { type Connection, LOCAL_TARGET } from "@miragon/pulse-runtime-view/host-kit"
import { CockpitView } from "../src/worker/cockpit-view.js"
import { FakeOrca } from "./fake-orca.js"

afterEach(() => {
  vi.useRealTimers()
})

class StubPanel implements Panel {
  readonly handled: WebviewIntent["type"][] = []
  readonly attended: Attention[] = []
  nudged = 0
  disposed = false
  answer: () => Promise<void> = () => Promise.resolve()

  handle(intent: WebviewIntent): Promise<void> {
    this.handled.push(intent.type)
    return this.answer()
  }

  attend(attention: Attention): void {
    this.attended.push(attention)
  }

  nudge(): void {
    this.nudged += 1
  }

  dispose(): void {
    this.disposed = true
  }
}

class Harness {
  readonly orca = new FakeOrca()
  readonly panels: StubPanel[] = []
  back: { label: string } | undefined
  publish: (state: PanelState) => void = () => undefined
  readonly view: CockpitView

  constructor(environment = "local") {
    this.view = new CockpitView(
      this.orca.api(),
      Harness.connection("shop", environment),
      {
        panel: () => {
          const panel = new StubPanel()
          this.panels.push(panel)
          return panel
        },
        context: (_connection, publish) => {
          this.publish = publish
          return {} as PanelContext
        },
      },
      () => this.back,
    )
  }

  get panel(): StubPanel {
    return this.panels.at(-1) ?? new StubPanel()
  }

  static connection(name: string, environment = "local", blocked = false): Connection {
    return {
      target: { ...LOCAL_TARGET, name },
      badge: { name, environment, host: "localhost:8080" },
      lane: { isBlocked: blocked },
    } as unknown as Connection
  }
}

describe("a cockpit view", () => {
  test("posts its state to every attached frame with the link back", () => {
    const harness = new Harness()
    harness.view.attach("left")
    harness.view.attach("right")
    harness.back = { label: "shop · Processes" }

    harness.publish({ status: "loading" } as PanelState)

    expect(harness.orca.posted.map((post) => post.panel)).toEqual(["left", "right"])
    expect(harness.orca.posted[0]?.payload).toMatchObject({ message: { back: harness.back } })
    expect(harness.view.label).toBe("shop")
    expect(harness.view.engineName).toBe("shop")
  })

  test("logs an intent that fails", async () => {
    const harness = new Harness()
    harness.panel.answer = () => Promise.reject(new Error("engine down"))

    expect(await harness.view.intent({ type: "refresh" })).toEqual([])
    expect(harness.orca.logs).toEqual(["intent refresh failed: Error: engine down"])
  })

  test("collects frame actions only within the click", async () => {
    vi.useFakeTimers()
    const harness = new Harness()
    harness.panel.answer = () => new Promise(() => undefined)

    const answering = harness.view.intent({ type: "openWebUi" })
    harness.view.frameAction({ kind: "openExternal", url: "https://cockpit/" })
    await vi.advanceTimersByTimeAsync(3000)
    harness.view.frameAction({ kind: "copy", text: "id", label: "Id" })

    expect(await answering).toEqual([{ kind: "openExternal", url: "https://cockpit/" }])
    expect(harness.orca.logs).toEqual(["copy needs a click in the view; it came too late"])
  })

  test("rebinds to a new connection and renders again while a frame shows it", () => {
    const harness = new Harness()
    const first = harness.panel
    harness.view.attach("frame")

    harness.view.rebind(Harness.connection("shop"))

    expect(first.disposed).toBe(true)
    expect(harness.panel.handled).toEqual(["ready"])
  })

  test("keeps its panel for the same connection and waits for a blocked lane", () => {
    const harness = new Harness()
    const connection = Harness.connection("shop", "local", true)
    harness.view.attach("frame")
    harness.view.rebind(connection)
    const panel = harness.panel

    harness.view.rebind(connection)

    expect(harness.panel).toBe(panel)
    expect(panel.handled).toEqual([])
  })

  test("refreshes after a saved model only on a local engine", () => {
    const local = new Harness()
    const remote = new Harness("production")

    local.view.nudgeLocal()
    remote.view.nudgeLocal()
    local.view.attend("watched")

    expect(local.panel.nudged).toBe(1)
    expect(remote.panel.nudged).toBe(0)
    expect(local.panel.attended).toEqual(["watched"])
  })

  test("is empty once its last frame left and disposes its panel", () => {
    const harness = new Harness()
    harness.view.attach("frame")
    harness.view.detach("frame")

    harness.view.dispose()

    expect(harness.view.isEmpty).toBe(true)
    expect(harness.panel.disposed).toBe(true)
  })
})
