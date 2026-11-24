import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import {
  type RecordingModuleServer,
  recordingModuleServer,
} from "@miragon/pulse-widget-shell/testing"
import { BoardParser } from "@miragon/pulse-board"
import type { EngineScreenData, FindScreenData, InstanceScreenData } from "@miragon/pulse-screens"
import { ScreenFigures, WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { RuntimeError } from "@miragon/pulse-engine-core"
import {
  FakeEngine as ContractFake,
  FakeWorld,
  PatchedRuntime,
} from "@miragon/pulse-engine-core/testing"
import type { EngineBoard } from "./board-files.js"
import { COCKPIT_ROUTES } from "./data/routes.js"
import { type ContractRuntime, createEngineRegistry } from "./lib/engine/resolve-engine.js"
import { engineModule } from "./module.js"
import { createPlugin, type EnginePluginConfig } from "./plugin.js"
import { providerForEntry } from "./providers/index.js"
import {
  ENGINE_BOARD_DATA,
  ENGINE_BPMN_XML_DATA,
  ENGINE_LIST_ENGINES,
  ENGINE_OPEN_COCKPIT,
  ENGINE_SCREEN_FIND_DATA,
  ENGINE_SCREEN_INCIDENT_TEXT_DATA,
  ENGINE_SCREEN_INSTANCE_DATA,
  ENGINE_SCREEN_INSTANCES_DATA,
  ENGINE_SCREEN_PROCESS_DATA,
  ENGINE_SCREEN_VARIABLE_NAMES_DATA,
  ENGINE_SCREEN_PROCESSES_DATA,
  ENGINE_WIDGET_ACTIONS_DATA,
} from "./tool-names.js"
import { worldReply } from "./tools/test-support/engine-world.js"
import { type FakeEngine, startFakeEngine } from "./tools/test-support/fake-engine.js"
import { feedPayload } from "./tools/test-support/feed-payload.js"

/**
 * An engine of another dialect beside a Camunda 7 one, hand-built: its runtime factory is a spy.
 * Every tool and feed of the admin surface offers it only where its mark serves its dialect (the
 * engine list, the board feed, the XML feed, the web app's screen feeds, the cockpit's board and
 * landing), and the call-time
 * net refuses it elsewhere before its runtime is built, the default engine above all.
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

  /**
   * The admin surface over a Camunda 7 engine `a` and the Camunda 8 engine `c8`, which the board
   * `orders` names; `cockpitUrl` its profile's, `defaultEngine` where a call without one goes.
   */
  async function bootOverBoth(cockpitUrl?: string, defaultEngine?: string) {
    const shop = await startFakeEngine({}, worldReply)
    started.push(shop)
    const runtime = vi.fn<ContractRuntime>(() => new ContractFake(FakeWorld.seed().state))
    const config: EnginePluginConfig = {
      engines: [
        { id: "a", baseUrl: shop.baseUrl },
        {
          id: "c8",
          baseUrl: "https://c8.example/v2",
          flavor: "camunda8",
          ...(cockpitUrl === undefined ? {} : { cockpitUrl }),
        },
      ],
      toolset: "admin",
      allowDeployments: true,
      boards: { boards: [ORDERS], refused: [] },
      ...(defaultEngine === undefined ? {} : { defaultEngine }),
    }
    const registry = createEngineRegistry(
      config.engines,
      (e) => providerForEntry(e).createClient(e, { type: "none" }),
      {
        contractRuntime: () => runtime,
        boardsNaming: (id) => (id === "c8" ? ["orders"] : []),
        defaultEngineId: defaultEngine,
      },
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
    ENGINE_SCREEN_PROCESSES_DATA,
    ENGINE_SCREEN_PROCESS_DATA,
    ENGINE_SCREEN_INSTANCES_DATA,
    ENGINE_SCREEN_VARIABLE_NAMES_DATA,
    ENGINE_SCREEN_INSTANCE_DATA,
    ENGINE_SCREEN_INCIDENT_TEXT_DATA,
    ENGINE_SCREEN_FIND_DATA,
    ENGINE_OPEN_COCKPIT,
    ENGINE_WIDGET_ACTIONS_DATA,
    // The screens and boards as JSON (#666), as the feeds they build alike.
    "engine_get_screen",
    "engine_get_board",
  ]
  const REFUSAL = '[ENGINE_DIALECT_NOT_SERVED] Engine "c8" is a Camunda 8 engine'

  /** The `engine` values a registered tool offers; none without the parameter. */
  function offered(recording: RecordingModuleServer, name: string): string[] | undefined {
    const input = recording.tool(name).config.inputSchema as z.ZodObject | undefined
    const engine = input?.shape.engine as z.ZodType | undefined
    return engine === undefined ? undefined : (z.toJSONSchema(engine) as { enum: string[] }).enum
  }

  it("offers it to no tool, feed or engine view that does not serve its dialect", async () => {
    const { recording } = await bootOverBoth()
    const others = [...recording.tools.keys()].filter((name) => !SERVING.includes(name))
    expect(others.length).toBeGreaterThan(50)
    for (const name of others) expect(offered(recording, name), name).toEqual(["a"])
    expect(offered(recording, ENGINE_BPMN_XML_DATA)).toEqual(["a", "c8"])
    expect(offered(recording, ENGINE_SCREEN_PROCESSES_DATA)).toEqual(["a", "c8"])
    expect(offered(recording, ENGINE_SCREEN_PROCESS_DATA)).toEqual(["a", "c8"])
    expect(offered(recording, ENGINE_SCREEN_INSTANCES_DATA)).toEqual(["a", "c8"])
    expect(offered(recording, ENGINE_SCREEN_VARIABLE_NAMES_DATA)).toEqual(["a", "c8"])
    expect(offered(recording, ENGINE_SCREEN_INSTANCE_DATA)).toEqual(["a", "c8"])
    expect(offered(recording, ENGINE_SCREEN_INCIDENT_TEXT_DATA)).toEqual(["a", "c8"])
    expect(offered(recording, ENGINE_SCREEN_FIND_DATA)).toEqual(["a", "c8"])
    expect(offered(recording, "engine_get_screen")).toEqual(["a", "c8"])
    // A board names its engines itself.
    expect(offered(recording, "engine_get_board")).toBeUndefined()
    // The cockpit's `engine` names every engine it shows: a route of one engine refuses this one.
    expect(offered(recording, ENGINE_OPEN_COCKPIT)).toEqual(["a", "c8"])
    expect(offered(recording, ENGINE_LIST_ENGINES)).toBeUndefined()
  })

  it("its call-time net refuses it as the default before building its runtime or sending anything", async () => {
    const { recording, runtime, shop, text } = await bootOverBoth(undefined, "c8")
    const refused = [...recording.tools.keys()].filter((name) => !SERVING.includes(name))
    for (const name of refused) {
      expect(await text(name, {}), name).toMatch(new RegExp(`^${escape(REFUSAL)}`))
      // Named, as no enum lets a model: the same net.
      expect(await text(name, { engine: "c8" }), name).toMatch(new RegExp(`^${escape(REFUSAL)}`))
    }
    expect(runtime).not.toHaveBeenCalled()
    expect(shop.requests).toEqual([])
  })

  it("refuses every engine view of the cockpit on it, and opens the picker without a view", async () => {
    const { runtime, text, recording } = await bootOverBoth(undefined, "c8")
    const engineViews = Object.entries(COCKPIT_ROUTES)
      .filter(([, route]) => route.scope === "engine")
      .map(([view]) => view)
    expect(engineViews.length).toBe(9)
    for (const view of engineViews) {
      expect(await text(ENGINE_OPEN_COCKPIT, { view }), view).toMatch(
        new RegExp(`^${escape(REFUSAL)}`),
      )
    }
    const picker = await recording.tool(ENGINE_OPEN_COCKPIT).call({})
    expect(picker.structuredContent).toMatchObject({ engineId: null, start: null })
    expect(runtime).not.toHaveBeenCalled()
  })

  // A page's link or the chat names it: the view of an engine shown on boards only, never
  // arguments the tool does not take.
  it("named, every engine view of the cockpit refuses it, and without a view the picker opens", async () => {
    const { runtime, text, recording } = await bootOverBoth()
    for (const view of ["overview", "jobs", "incidents"]) {
      expect(await text(ENGINE_OPEN_COCKPIT, { view, engine: "c8" }), view).toMatch(
        new RegExp(`^${escape(REFUSAL)}`),
      )
    }
    const picker = await recording.tool(ENGINE_OPEN_COCKPIT).call({ engine: "c8" })
    expect(picker.isError).not.toBe(true)
    expect(picker.structuredContent).toMatchObject({ engineId: null, start: null })
    expect(runtime).not.toHaveBeenCalled()
  })

  it("lists it without reading it, and names it among the engines no write reaches", async () => {
    const { recording, runtime } = await bootOverBoth()
    const list = JSON.parse(
      (await recording.tool(ENGINE_LIST_ENGINES).call({})).content[0].text,
    ) as { engines: unknown[] }
    expect(list.engines).toEqual([
      expect.objectContaining({ id: "a", dialect: "c7" }),
      {
        id: "c8",
        environment: "default",
        dialect: "c8",
        flavor: "camunda8",
        engineName: "Camunda 8",
      },
    ])
    const actions = feedPayload<{ readOnlyEngines: string[] }>(
      await recording.tool(ENGINE_WIDGET_ACTIONS_DATA).call({}),
    )
    expect(actions.readOnlyEngines).toEqual(["c8"])
    expect(runtime).not.toHaveBeenCalled()
  })

  it("serves the XML feed, the board feed and the screen feeds through its runtime", async () => {
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
    // The web app's engine screen of the kit's world: the numbers its builder gives that world.
    const screen = feedPayload<EngineScreenData>(
      await recording.tool(ENGINE_SCREEN_PROCESSES_DATA).call({ engine: "c8" }),
    )
    expect(ScreenFigures.engine(screen)).toEqual(ScreenFigures.engine(WORLD_SCREENS.engine))
    // Its instance screen and the text of the root incident the instance it called holds.
    const called = WORLD_SCREENS.calledInstance
    const instance = feedPayload<InstanceScreenData>(
      await recording
        .tool(ENGINE_SCREEN_INSTANCE_DATA)
        .call({ engine: "c8", instance: called.instance.id }),
    )
    expect(ScreenFigures.instance(instance)).toEqual(ScreenFigures.instance(called))
    const [card] = called.incidents
    const text = feedPayload<{ rootCause: string | null }>(
      await recording
        .tool(ENGINE_SCREEN_INCIDENT_TEXT_DATA)
        .call({ engine: "c8", incident: card?.rootIncident.id }),
    )
    expect(text.rootCause).toBe(card?.rootCauseLine)
    // What the search finds on it by a business key.
    const found = feedPayload<FindScreenData>(
      await recording.tool(ENGINE_SCREEN_FIND_DATA).call({ engine: "c8", text: "ORD-1003" }),
    )
    expect(ScreenFigures.find(found)).toEqual(ScreenFigures.find(WORLD_SCREENS.find))
    expect(runtime).toHaveBeenCalled()
  })

  it("says a failed XML read with the contract's failure and the hint it carries", async () => {
    const { runtime, text } = await bootOverBoth()
    const refusal = (hint?: string) =>
      new RuntimeError("misconfigured", "[404 NOT_FOUND] No such path (engine c8)", { hint })
    const failing = (error: RuntimeError) => () =>
      new PatchedRuntime(new ContractFake(FakeWorld.seed().state), {
        getDiagramXml: () => Promise.reject(error),
      })
    const xml = { engine: "c8", processDefinitionId: "2251799813685249" }
    runtime.mockImplementation(failing(refusal("The url must end in /v2.")))
    expect(await text(ENGINE_BPMN_XML_DATA, xml)).toBe(
      "[misconfigured] [404 NOT_FOUND] No such path (engine c8) The url must end in /v2.",
    )
    runtime.mockImplementation(failing(refusal()))
    expect(await text(ENGINE_BPMN_XML_DATA, xml)).toBe(
      "[misconfigured] [404 NOT_FOUND] No such path (engine c8)",
    )
  })

  it("hands the cockpit each engine's dialect, and for this one the boards that name it", async () => {
    const { recording, runtime } = await bootOverBoth()
    const picker = await recording.tool(ENGINE_OPEN_COCKPIT).call({})
    expect(picker.structuredContent).toEqual({
      engineId: null,
      engines: [
        { id: "a", environment: "default", dialect: "c7" },
        { id: "c8", environment: "default", dialect: "c8", boards: ["orders"] },
      ],
      start: null,
    })
    expect(runtime).not.toHaveBeenCalled()
  })

  it.each([
    ["https://operate.example/operate", "https://operate.example/operate"],
    [" http://localhost:8088/operate/ ", "http://localhost:8088/operate/"],
    ["javascript:alert(1)", undefined],
    ["operate.example/operate", undefined],
  ])("hands the cockpit its web app from cockpitUrl %j, http(s) only", async (url, webAppUrl) => {
    const { recording } = await bootOverBoth(url)
    const picker = await recording.tool(ENGINE_OPEN_COCKPIT).call({})
    const [, c8] = (picker.structuredContent as { engines: Array<Record<string, unknown>> }).engines
    expect(c8.webAppUrl).toBe(webAppUrl)
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

/**
 * The same seam from the module's own configuration: Camunda 8 profiles of ENGINES_JSON, alone or
 * beside a Camunda 7 one, and a board of ENGINE_BOARDS_DIR that names one of them. Nothing is
 * sent: every call here refuses or reads no engine.
 */
describe("createPlugin over Camunda 8 profiles and the boards that name them", () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })

  /** The plugin `configFromEnv` configures: `c8` on the board `orders`, `lone` on none. */
  function bootFromEnv(beside: Record<string, unknown> = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-c8-boards-"))
    dirs.push(dir)
    fs.writeFileSync(
      path.join(dir, "orders.board.json"),
      JSON.stringify({ title: "Orders", engines: ["c8"], rows: [{ row: [{ widget: "chart" }] }] }),
    )
    const config = engineModule.configFromEnv({
      ENGINES_JSON: JSON.stringify({
        defaultProfile: "c8",
        profiles: {
          c8: { url: "https://c8.example/v2", flavor: "camunda8" },
          lone: { url: "https://lone.example/v2", flavor: "camunda8" },
          ...beside,
        },
      }),
      ENGINE_BOARDS_DIR: dir,
    })
    const recording = recordingModuleServer()
    engineModule.createPlugin({ ...config, toolset: "admin" }).register(recording.server)
    return recording
  }

  it("a server of Camunda 8 engines alone registers what serves them, and nothing else", async () => {
    const recording = bootFromEnv()
    expect([...recording.tools.keys()].sort()).toEqual(
      [
        ENGINE_LIST_ENGINES,
        ENGINE_OPEN_COCKPIT,
        ENGINE_BPMN_XML_DATA,
        ENGINE_BOARD_DATA,
        ENGINE_SCREEN_PROCESSES_DATA,
        ENGINE_SCREEN_PROCESS_DATA,
        ENGINE_SCREEN_INSTANCES_DATA,
        ENGINE_SCREEN_VARIABLE_NAMES_DATA,
        ENGINE_SCREEN_INSTANCE_DATA,
        ENGINE_SCREEN_INCIDENT_TEXT_DATA,
        ENGINE_SCREEN_FIND_DATA,
        "engine_get_screen",
        "engine_get_board",
      ].sort(),
    )
    // The prompt drafts through a Camunda 7 tool, which is not there.
    expect([...recording.prompts.keys()]).toEqual([])
    const cockpit = recording.tool(ENGINE_OPEN_COCKPIT).config.inputSchema as z.ZodObject
    expect(Object.keys(cockpit.shape)).toEqual(["view", "board"])
    expect((z.toJSONSchema(cockpit.shape.view as z.ZodType) as { enum: string[] }).enum).toEqual([
      "board",
      "landing",
    ])
    // Without a view it opens where its engines and boards are: the landing, reading nothing.
    const opened = await recording.tool(ENGINE_OPEN_COCKPIT).call({})
    expect(opened.structuredContent).toMatchObject({
      engineId: null,
      start: { view: { section: "landing" }, data: { boards: [{ id: "orders" }] } },
    })
    expect(JSON.parse(opened.content[0].text)).toMatchObject({ view: "landing" })
  })

  it("names the boards of each engine in its refusal and in the cockpit's engines", async () => {
    const recording = bootFromEnv({ a: { url: "https://a.example/engine-rest" } })
    const status = async (engine: string) =>
      (await recording.tool("engine_status").call({ engine })).content
        .map((part) => ("text" in part ? part.text : ""))
        .join("")
    expect(await status("c8")).toContain(
      "This server reads a Camunda 8 engine on boards only: engine_list_engines lists the boards that name it, and engine_open_cockpit with view board shows one.",
    )
    expect(await status("lone")).toContain(
      'This server reads a Camunda 8 engine on boards only, and no board names "lone" yet;',
    )
    const picker = await recording.tool(ENGINE_OPEN_COCKPIT).call({})
    expect(picker.structuredContent).toEqual({
      engineId: null,
      engines: [
        { id: "c8", environment: "default", dialect: "c8", boards: ["orders"] },
        { id: "lone", environment: "default", dialect: "c8", boards: [] },
        { id: "a", environment: "default", dialect: "c7" },
      ],
      start: null,
    })
  })
})

/** `text` as a literal in a regular expression. */
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
