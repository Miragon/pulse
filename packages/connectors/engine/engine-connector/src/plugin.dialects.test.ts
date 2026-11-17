import { afterEach, describe, expect, it, vi } from "vitest"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { BoardParser } from "@miragon/pulse-board"
import { FakeEngine as ContractFake, FakeWorld } from "@miragon/pulse-engine-core/testing"
import type { EngineBoard } from "./board-files.js"
import { COCKPIT_ROUTES } from "./data/routes.js"
import { type ContractRuntime, createEngineRegistry } from "./lib/engine/resolve-engine.js"
import { createPlugin, type EnginePluginConfig } from "./plugin.js"
import { providerForEntry } from "./providers/index.js"
import {
  ENGINE_BOARD_DATA,
  ENGINE_BPMN_XML_DATA,
  ENGINE_LIST_ENGINES,
  ENGINE_OPEN_COCKPIT,
  ENGINE_WIDGET_ACTIONS_DATA,
} from "./tool-names.js"
import { worldReply } from "./tools/test-support/engine-world.js"
import { type FakeEngine, startFakeEngine } from "./tools/test-support/fake-engine.js"
import { feedPayload } from "./tools/test-support/feed-payload.js"

/**
 * An engine of another dialect, hand-built (no profile yields one yet): its runtime factory is a
 * spy. Every tool and feed of the admin surface called on it is refused before its runtime is
 * built, or it is served through the engine contract (the engine list, the board feed, the XML
 * feed, the cockpit's board and landing).
 */
describe("createPlugin on an engine of another dialect", () => {
  const started: FakeEngine[] = []
  afterEach(async () => {
    await Promise.all(started.splice(0).map((engine) => engine.close()))
  })

  const ORDERS: EngineBoard = (() => {
    const parsed = BoardParser.parse(
      JSON.stringify({
        title: "Orders",
        engines: ["a", "c8"],
        rows: [{ row: [{ widget: "counter", props: { filter: { process: "order" } } }] }],
      }),
    )
    if (!("board" in parsed)) throw new Error(JSON.stringify(parsed.problems))
    return { id: "orders", file: "orders.board.json", board: parsed.board, notes: [] }
  })()

  /** The admin surface over a Camunda 7 engine `a` and the Camunda 8 engine `c8`. */
  async function bootOverBoth() {
    const shop = await startFakeEngine({}, worldReply)
    started.push(shop)
    const runtime = vi.fn<ContractRuntime>(() => new ContractFake(FakeWorld.seed().state))
    const config: EnginePluginConfig = {
      engines: [
        { id: "a", baseUrl: shop.baseUrl },
        { id: "c8", baseUrl: "https://c8.example/v2", flavor: "camunda8" },
      ],
      toolset: "admin",
      allowDeployments: true,
      boards: { boards: [ORDERS], refused: [] },
    }
    const registry = createEngineRegistry(
      config.engines,
      (e) => providerForEntry(e).createClient(e, { type: "none" }),
      { contractRuntime: () => runtime, boardsNaming: (id) => (id === "c8" ? ["orders"] : []) },
    )
    const recording = recordingModuleServer()
    createPlugin(config, registry).register(recording.server)
    const text = async (name: string, args: Record<string, unknown>) =>
      (await recording.tool(name).call(args)).content
        .map((part) => ("text" in part ? part.text : ""))
        .join("")
    return { recording, runtime, shop, text }
  }

  /** What serves such an engine, or reads none (the widget actions). */
  const SERVING = [
    ENGINE_LIST_ENGINES,
    ENGINE_BOARD_DATA,
    ENGINE_BPMN_XML_DATA,
    ENGINE_OPEN_COCKPIT,
    ENGINE_WIDGET_ACTIONS_DATA,
  ]
  const REFUSAL = '[ENGINE_DIALECT_NOT_SERVED] Engine "c8" is a Camunda 8 engine'

  it("refuses every other tool and feed on it before building its runtime or sending anything", async () => {
    const { recording, runtime, shop, text } = await bootOverBoth()
    const refused = [...recording.tools.keys()].filter((name) => !SERVING.includes(name))
    expect(refused.length).toBeGreaterThan(50)
    for (const name of refused) {
      expect(await text(name, { engine: "c8" }), name).toMatch(new RegExp(`^${escape(REFUSAL)}`))
    }
    expect(runtime).not.toHaveBeenCalled()
    expect(shop.requests).toEqual([])
  })

  it("refuses every engine view of the cockpit on it, and opens the picker without a view", async () => {
    const { runtime, text, recording } = await bootOverBoth()
    const engineViews = Object.entries(COCKPIT_ROUTES)
      .filter(([, route]) => route.scope === "engine")
      .map(([view]) => view)
    expect(engineViews.length).toBe(9)
    for (const view of engineViews) {
      expect(await text(ENGINE_OPEN_COCKPIT, { engine: "c8", view }), view).toMatch(
        new RegExp(`^${escape(REFUSAL)}`),
      )
    }
    const picker = await recording.tool(ENGINE_OPEN_COCKPIT).call({ engine: "c8" })
    expect(picker.structuredContent).toMatchObject({ engineId: null, start: null })
    expect(runtime).not.toHaveBeenCalled()
  })

  it("lists it without reading it, and names it among the engines no write reaches", async () => {
    const { recording, runtime } = await bootOverBoth()
    const list = JSON.parse(
      (await recording.tool(ENGINE_LIST_ENGINES).call({})).content[0].text,
    ) as { engines: unknown[] }
    expect(list.engines).toContainEqual({
      id: "c8",
      environment: "default",
      flavor: "camunda8",
      engineName: "Camunda 8",
    })
    const actions = feedPayload<{ readOnlyEngines: string[] }>(
      await recording.tool(ENGINE_WIDGET_ACTIONS_DATA).call({}),
    )
    expect(actions.readOnlyEngines).toEqual(["c8"])
    expect(runtime).not.toHaveBeenCalled()
  })

  it("serves the XML feed and the board feed through its runtime", async () => {
    const { recording, runtime } = await bootOverBoth()
    const definitionId = FakeWorld.seed().world.definitionIds["order@1"]
    const xml = feedPayload<{ bpmnXml: string | null }>(
      await recording
        .tool(ENGINE_BPMN_XML_DATA)
        .call({ engine: "c8", processDefinitionId: definitionId }),
    )
    expect(xml.bpmnXml).toContain("<bpmn:definitions")
    const board = feedPayload<{ engines: Array<{ name: string; state: string }> }>(
      await recording.tool(ENGINE_BOARD_DATA).call({ board: "orders" }),
    )
    expect(board.engines.map(({ name, state }) => [name, state])).toEqual([
      ["a", "ready"],
      ["c8", "ready"],
    ])
    expect(runtime).toHaveBeenCalled()
  })

  it("serves the cockpit's board and landing", async () => {
    const { recording } = await bootOverBoth()
    const board = await recording.tool(ENGINE_OPEN_COCKPIT).call({ view: "board", board: "orders" })
    expect(board.structuredContent).toMatchObject({
      engineId: null,
      engines: [{ id: "a" }, { id: "c8" }],
      start: { view: { section: "board", board: "orders" } },
    })
    const landing = await recording.tool(ENGINE_OPEN_COCKPIT).call({ view: "landing" })
    expect(landing.structuredContent).toMatchObject({
      start: { view: { section: "landing" }, data: { boards: [{ id: "orders" }] } },
    })
  })
})

/** `text` as a literal in a regular expression. */
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
