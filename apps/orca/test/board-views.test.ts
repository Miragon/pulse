import { describe, expect, test, vi } from "vitest"
import {
  FailingRuntime,
  type ProcessRuntime,
  RuntimeError,
} from "@miragon/pulse-runtime-view/contract"
import { FakeEngine, FakeWorld } from "@miragon/pulse-runtime-view/contract/fake"
import type { BoardTile, BoardView } from "@miragon/pulse-runtime-view/protocol"
import { type Connection, LOCAL_TARGET } from "@miragon/pulse-runtime-view/host-kit"
import { BoardTemplate } from "../src/worker/board-template.js"
import { BoardViews } from "../src/worker/board-views.js"
import type { EngineRegistry } from "../src/worker/engine-registry.js"
import { ConnectionLive } from "./connection-live.js"
import { FakeOrca } from "./fake-orca.js"

class Harness {
  readonly orca = new FakeOrca()
  readonly host = { open: vi.fn(), editEngines: vi.fn(), askForLogin: vi.fn() }
  readonly boards: BoardViews
  private readonly changes: (() => void)[] = []

  constructor() {
    const connections = new Map([
      ["shop", Harness.connection("shop", new FakeEngine(FakeWorld.seed().state))],
      [
        "locked",
        Harness.connection(
          "locked",
          new FailingRuntime(new RuntimeError("unauthorized", "Login refused")),
        ),
      ],
    ])
    const registry = {
      byName: (name: string) => connections.get(name),
      onDidChange: (listener: () => void) => {
        this.changes.push(listener)
        return () => undefined
      },
    } as unknown as EngineRegistry
    this.boards = new BoardViews(this.orca.api(), registry, this.host)
  }

  static async ready(engines: readonly string[] = ["shop"]): Promise<Harness> {
    const harness = new Harness()
    harness.boards.attach("frame", BoardTemplate.of("Shop", engines))
    await harness.boards.intent("frame", { type: "ready" })
    return harness
  }

  static connection(name: string, runtime: ProcessRuntime): Connection {
    return {
      target: { ...LOCAL_TARGET, name },
      badge: { name, environment: "local", host: "localhost:8080" },
      runtime,
      ...ConnectionLive.of(runtime),
    } as unknown as Connection
  }

  changeEngines(): void {
    for (const listener of this.changes) {
      listener()
    }
  }

  view(): BoardView {
    const states = this.orca.postsOf("cockpit.state") as {
      message: { state: { view: BoardView } }
    }[]
    const view = states.at(-1)?.message.state.view
    if (view === undefined) {
      throw new Error("no board view")
    }
    return view
  }

  tiles(): BoardTile[] {
    return this.view().rows.flat()
  }
}

describe("boards in editor tabs", () => {
  test("open an instance the board lists", async () => {
    const harness = await Harness.ready()
    const list = harness.tiles().find((tile) => tile.kind === "instanceList")
    const instanceId = list?.kind === "instanceList" ? list.groups[0]?.rows[0]?.id : undefined
    const intent = { type: "openBoardInstance", engine: "shop", instanceId, toSide: false }

    await harness.boards.intent("frame", intent)

    expect(harness.host.open).toHaveBeenCalledWith("shop", { view: "instance", instanceId })
  })

  test("open a process the board lists", async () => {
    const harness = await Harness.ready()
    const summary = harness.tiles().find((tile) => tile.kind === "incidentSummary")
    const target = summary?.kind === "incidentSummary" ? summary.rows[0]?.target : undefined
    const intent = { type: "openBoardProcess", toSide: false, ...target }

    await harness.boards.intent("frame", intent)

    expect(harness.host.open).toHaveBeenCalledWith("shop", {
      view: "definition",
      bpmnProcessId: target?.bpmnProcessId,
      filter: target?.filter,
    })
  })

  test("open an engine, its configuration and the board file", async () => {
    const harness = await Harness.ready()

    await harness.boards.intent("frame", { type: "openBoardEngine", engine: "shop", toSide: true })
    await harness.boards.intent("frame", { type: "editConnection" })
    await harness.boards.intent("frame", { type: "openBoardFile" })

    expect(harness.host.open).toHaveBeenCalledWith("shop", { view: "engine" })
    expect(harness.host.editEngines).toHaveBeenCalled()
    expect(harness.orca.logs).toEqual(["Switch the tab to Source to edit the board file."])
  })

  test("ask for the login of an engine that refused it", async () => {
    const harness = await Harness.ready(["locked"])

    await harness.boards.intent("frame", { type: "setBoardCredentials", engine: "locked" })

    expect(harness.host.askForLogin).toHaveBeenCalledWith("locked")
  })

  test("name an engine the project file does not configure", async () => {
    const harness = await Harness.ready(["shop", "gone"])

    expect(harness.view().engines.map((engine) => [engine.name, engine.state])).toContainEqual([
      "gone",
      "notConfigured",
    ])
    await harness.boards.intent("frame", { type: "setBoardCredentials", engine: "gone" })
    expect(harness.host.askForLogin).not.toHaveBeenCalled()
  })

  test("ignore what is no intent and refresh when the engines change", async () => {
    const harness = await Harness.ready()
    const posted = harness.orca.posted.length

    expect(await harness.boards.intent("frame", { type: "activity" })).toEqual({
      known: true,
      actions: [],
    })
    expect(await harness.boards.intent("frame", "nonsense")).toEqual({ known: true, actions: [] })
    harness.changeEngines()

    await vi.waitFor(() => {
      expect(harness.orca.posted.length).toBeGreaterThan(posted)
    })
  })

  test("forget a closed board", async () => {
    const harness = await Harness.ready()

    harness.boards.dispose()

    expect(harness.boards.knows("frame")).toBe(false)
    expect(await harness.boards.intent("frame", { type: "ready" })).toEqual({
      known: false,
      actions: [],
    })
    expect(harness.boards.changed("frame", "{}")).toBe(false)
  })
})
