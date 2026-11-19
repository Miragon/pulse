/**
 * The board feed end to end: the module's configuration (ENGINES_JSON, ENGINE_BOARDS_DIR), the
 * plugin, and `engine_board_data` over the fake engine's world. Its floor (the build kept per
 * caller and board) is board-data.floor.test.ts's; how each failed read degrades, the
 * honest-numbers table's.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { z } from "zod"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { BoardParser, BoardProblems } from "@miragon/pulse-board"
import { BoardBuilder, BoardJson, type BoardReads } from "@miragon/pulse-board/builder"
import { FakeEngine, FakeWorld } from "@miragon/pulse-engine-core/testing"
import type { EngineBoard } from "../board-files.js"
import { createC8Connection } from "../lib/engine/c8-connection.js"
import { c8RuntimeOf } from "../lib/engine/engine-runtime.js"
import {
  type ContractRuntime,
  createEngineRegistry,
  resolveEngine,
} from "../lib/engine/resolve-engine.js"
import {
  type Answer,
  c8Platform,
  CLUSTER,
  problem,
} from "../lib/engine/test-support/c8-platform.js"
import { engineModule } from "../module.js"
import { createPlugin, type EnginePluginConfig } from "../plugin.js"
import { providerForEntry } from "../providers/index.js"
import { ENGINE_BOARD_DATA } from "../tool-names.js"
import { feedPayload } from "../tools/test-support/feed-payload.js"
import { worldReply } from "../tools/test-support/engine-world.js"
import {
  type FakeEngine as FakeC7Engine,
  type FakeRoutes,
  startFakeEngine,
} from "../tools/test-support/fake-engine.js"
import type { BoardStartData } from "../view-models.board.js"
import type { TileData } from "@miragon/pulse-board"
import { boardReadsOf } from "./board-reads.js"

const engines: FakeC7Engine[] = []
const dirs: string[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

async function fakeEngine(routes: FakeRoutes = {}): Promise<FakeC7Engine> {
  const engine = await startFakeEngine(routes, worldReply)
  engines.push(engine)
  return engine
}

const ORDERS = {
  title: "Orders",
  theme: "dark",
  engines: ["shop", "c8", "locked", "nowhere"],
  rows: [
    {
      row: [
        { widget: "counter", props: { filter: { process: "order", activeElement: "charge" } } },
        { widget: "incidentSummary", props: { groupBy: "engine" } },
      ],
    },
    {
      row: [
        { widget: "instanceList", props: { engines: ["shop"], filter: { process: "order" } } },
        { widget: "chart" },
      ],
    },
  ],
}

/**
 * The refusal a call to the camunda8 profile gets, as engine_status gives it: the server signs in
 * to a Camunda 8 engine with no fixed bearer token.
 */
const C8_REFUSAL =
  '[ENGINE_PROFILE_REFUSED] Engine "c8" is configured, but its profile cannot be used: ' +
  "This server cannot sign in to a Camunda 8 engine with this auth.type: it signs in with " +
  "none, basic or clientCredentials, whose tokens it gets itself. Ask whoever runs this server " +
  "to fix it."

/**
 * The server of a profile file with `shop` on the fake engine (its world, but `routes`) and a
 * board directory of `files`.
 */
async function boot(files: Record<string, unknown>, routes: FakeRoutes = {}) {
  const [shop, c8] = [await fakeEngine(routes), await fakeEngine()]
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-board-feed-"))
  dirs.push(dir)
  for (const [name, file] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(file))
  }
  const config = engineModule.configFromEnv({
    ENGINES_JSON: JSON.stringify({
      defaultProfile: "shop",
      profiles: {
        shop: { url: shop.baseUrl, flavor: "cibseven" },
        c8: {
          url: c8.baseUrl,
          flavor: "camunda8",
          auth: { type: "bearer", tokenEnv: "ENGINE_SECRET_C8" },
        },
        locked: {
          url: "http://locked.invalid/engine-rest",
          auth: { type: "bearer", tokenEnv: "ENGINE_SECRET_LOCKED" },
        },
      },
    }),
    ENGINE_BOARDS_DIR: dir,
  })
  const recording = recordingModuleServer()
  engineModule.createPlugin(config).register(recording.server)
  const feed = recording.tool(ENGINE_BOARD_DATA)
  const read = async (args: Record<string, unknown>) =>
    feed.call((feed.config.inputSchema as z.ZodObject).parse(args))
  const board = async (id: string) => feedPayload<BoardStartData>(await read({ board: id }))
  const text = async (id: string) =>
    (await read({ board: id })).content.map((part) => ("text" in part ? part.text : "")).join("")
  return { shop, c8, board, text, feed }
}

describe("engine_board_data: a board of ENGINE_BOARDS_DIR, built over the engines it names", () => {
  it("shows each engine in its place: ready, refused by its profile (camunda8 too), not configured", async () => {
    const { c8, board } = await boot({ "orders.board.json": ORDERS })
    const data = await board("orders")
    expect(data.title).toBe("Orders")
    expect(data.engines).toEqual([
      {
        name: "shop",
        state: "ready",
        product: "CIB seven",
        version: "2.1.0",
        totals: { running: 3, withIncident: 1 },
      },
      {
        name: "c8",
        state: "failed",
        failure: { code: "ENGINE_PROFILE_REFUSED", message: C8_REFUSAL },
      },
      {
        name: "locked",
        state: "failed",
        failure: {
          code: "ENGINE_PROFILE_REFUSED",
          message: expect.stringMatching(
            /^\[ENGINE_PROFILE_REFUSED\] Engine "locked" is configured/,
          ) as unknown,
        },
      },
      { name: "nowhere", state: "notConfigured" },
    ])
    // A refused profile is asked nothing.
    expect(c8.requests).toEqual([])
  })

  it("shows an engine that fails to say what it is failed, with the failure kind and the model's words", async () => {
    const { shop, board } = await boot(
      { "orders.board.json": ORDERS },
      {
        "GET /telemetry/data": {
          status: 503,
          body: { type: "ProcessEngineException", message: "down" },
        },
      },
    )
    const data = await board("orders")
    expect(data.engines[0]).toEqual({
      name: "shop",
      state: "failed",
      failure: {
        code: "engineFailure",
        message: "[503 ProcessEngineException] down (engine shop)",
      },
    })
    expect(data.rows[0]?.[0]).toMatchObject({ kind: "counter", known: 0 })
    expect(shop.requests.map(({ path }) => path)).toEqual(["/telemetry/data"])
  })

  it("counts each tile on the engines that answer, a number not read left out, never 0", async () => {
    const { board } = await boot({ "orders.board.json": ORDERS })
    const [[counter, summary], [list, refused]] = (await board("orders")).rows
    expect(counter).toMatchObject({
      kind: "counter",
      readings: [
        { engine: "shop", count: { count: 1 } },
        { engine: "c8" },
        { engine: "locked" },
        { engine: "nowhere" },
      ],
      known: 1,
      total: { count: 1 },
    })
    expect(summary).toMatchObject({
      kind: "incidentSummary",
      engines: 4,
      known: 1,
      total: 1,
      rows: [
        { engine: "shop", withIncident: 1 },
        { engine: "c8" },
        { engine: "locked" },
        { engine: "nowhere" },
      ],
    })
    expect(list).toMatchObject({
      kind: "instanceList",
      groups: [
        {
          engine: "shop",
          total: { count: 1 },
          instances: [
            {
              id: "pi-1",
              definition: { id: "order:1:d1", bpmnProcessId: "order", version: 1, name: "Order" },
              state: "running",
              hasIncident: true,
              businessKey: "B-1",
            },
          ],
        },
      ],
    })
    expect(refused).toEqual({
      kind: "refused",
      widget: "chart",
      problems: [
        {
          path: "rows[1].row[1].widget",
          code: "notOneOf",
          values: {
            choices: [
              "counter",
              "instanceList",
              "incidentSummary",
              "processDiagram",
              "incidentList",
            ],
          },
        },
      ],
    })
  })

  it("carries the file's notes, the time its reads began, and survives JSON as it is", async () => {
    const before = Date.now()
    const { board } = await boot({ "orders.board.json": ORDERS })
    const data = await board("orders")
    expect(data.notes).toEqual([{ path: "theme", code: "ignoredKey" }])
    expect(BoardProblems.describe(data.notes[0])).toMatch(/^is not a key/)
    expect(Date.parse(data.asOf)).toBeGreaterThanOrEqual(before - 1)
    expect(Date.parse(data.asOf)).toBeLessThanOrEqual(Date.now())
    expect(JSON.parse(JSON.stringify(data))).toEqual(data)
  })

  it("refuses an id it shows no board for, listing the boards it shows", async () => {
    const { text } = await boot({
      "orders.board.json": ORDERS,
      "broken.board.json": { title: "Broken" },
      "stock.board.json": { ...ORDERS, title: "Stock" },
    })
    expect(await text("billing")).toBe(
      '[UNKNOWN_BOARD] Unknown board id "billing". Boards: orders, stock.',
    )
    expect(await text("broken")).toBe(
      '[BOARD_REFUSED] Board "broken" cannot be shown. Its file broken.board.json gives no board: engines is missing; rows is missing. Ask whoever runs this server to fix it.',
    )
  })

  it("refuses every id on a server without boards", async () => {
    const shop = await fakeEngine()
    const recording = recordingModuleServer()
    engineModule
      .createPlugin(engineModule.configFromEnv({ ENGINE_BASE_URL: shop.baseUrl }))
      .register(recording.server)
    const result = await recording.tool(ENGINE_BOARD_DATA).call({ board: "orders" })
    expect(result.content).toEqual([
      {
        type: "text",
        text: '[UNKNOWN_BOARD] Unknown board id "orders": this server shows no board.',
      },
    ])
    expect(shop.requests).toEqual([])
  })

  it("takes a board id and nothing else: no engine, no unknown key, no id the rule refuses", async () => {
    const { feed } = await boot({ "orders.board.json": ORDERS })
    const schema = feed.config.inputSchema as z.ZodObject
    expect(Object.keys(schema.shape)).toEqual(["board"])
    expect(schema.safeParse({ board: "orders" }).success).toBe(true)
    for (const args of [
      {},
      { board: "orders", engine: "shop" },
      { board: "../orders" },
      { board: "" },
    ]) {
      expect(schema.safeParse(args).success, JSON.stringify(args)).toBe(false)
    }
  })
})

/**
 * A board over both dialects: the Camunda 7 engine `shop` over its client, an engine of another
 * dialect (hand-built, engine-core's fake world behind its runtime) through the engine contract,
 * each with the numbers the board builder gives over its reads alone.
 */
describe("engine_board_data over both dialects", () => {
  /** The process each engine's world deploys: the fake engine's, engine-core's fake world's. */
  const PROCESS: Record<string, string> = { shop: "order", c8: "pulse-order" }

  /** A board over `engines`: a counter, a diagram of each engine's process and the incidents. */
  function boardOver(engines: readonly string[]): EngineBoard {
    const parsed = BoardParser.parse(
      JSON.stringify({
        title: "Both",
        engines,
        rows: [
          { row: [{ widget: "counter", props: { filter: {} } }] },
          {
            row: engines.map((engine) => ({
              widget: "processDiagram",
              props: { process: PROCESS[engine], engines: [engine] },
            })),
          },
          { row: [{ widget: "incidentList" }] },
        ],
      }),
    )
    if (!("board" in parsed)) throw new Error(JSON.stringify(parsed.problems))
    return { id: "both", file: "both.board.json", board: parsed.board, notes: [] }
  }

  /** The built board as the builder gives it over one engine's reads alone. */
  async function alone(name: string, reads: BoardReads) {
    const model = await BoardBuilder.build(boardOver([name]).board, [{ name, reads }])
    return BoardJson.of(model, { failureOf: () => ({ code: "unexpected" }), notes: [] })
  }

  /** What a tile of `kind` shows per engine: its readings, its groups or the tile itself. */
  const perEngine = (tile: TileData | undefined): readonly unknown[] => {
    if (tile?.kind === "counter") return tile.readings
    if (tile?.kind === "incidentList") return tile.groups
    return [tile]
  }

  it("reads each engine in its dialect, with the numbers of its reads alone", async () => {
    const shop = await fakeEngine()
    const runtime = vi.fn<ContractRuntime>(() => new FakeEngine(FakeWorld.seed().state))
    const config: EnginePluginConfig = {
      engines: [
        { id: "shop", baseUrl: shop.baseUrl, flavor: "cibseven" },
        { id: "c8", baseUrl: "https://c8.example/v2", flavor: "camunda8" },
      ],
      boards: { boards: [boardOver(["shop", "c8"])], refused: [] },
    }
    const registry = createEngineRegistry(
      config.engines,
      (entry) => providerForEntry(entry).createClient(entry, { type: "none" }),
      { contractRuntime: () => runtime },
    )
    const recording = recordingModuleServer()
    createPlugin(config, registry).register(recording.server)
    const data = feedPayload<BoardStartData>(
      await recording.tool(ENGINE_BOARD_DATA).call({ board: "both" }),
    )

    const c7 = await alone("shop", boardReadsOf(resolveEngine("shop", registry), { failed: false }))
    const c8 = await alone("c8", new FakeEngine(FakeWorld.seed().state))
    expect(data.engines).toEqual([...c7.engines, ...c8.engines])
    expect(data.engines.map(({ state }) => state)).toEqual(["ready", "ready"])
    const [[counter], [shopDiagram, c8Diagram], [incidents]] = data.rows
    expect(counter).toMatchObject({ kind: "counter", known: 2 })
    // A diagram draws its badges only over the XML it read: through the one XML cache on both.
    expect(shopDiagram).toMatchObject({ kind: "processDiagram", engine: "shop" })
    expect(c8Diagram).toMatchObject({ kind: "processDiagram", engine: "c8" })
    expect([shopDiagram, c8Diagram].map((tile) => tile !== undefined && "badges" in tile)).toEqual([
      true,
      true,
    ])
    expect(perEngine(counter)).toEqual([...perEngine(c7.rows[0][0]), ...perEngine(c8.rows[0][0])])
    expect([shopDiagram, c8Diagram]).toEqual([c7.rows[1][0], c8.rows[1][0]])
    expect(perEngine(incidents)).toEqual([...perEngine(c7.rows[2][0]), ...perEngine(c8.rows[2][0])])
    // The engine of another dialect is read through its runtime, on the call's signal.
    expect(runtime).toHaveBeenCalled()
  })

  /** The board of the one Camunda 8 engine `c8`, over the server's wire answering `topology`. */
  async function c8BoardOver(topology: Answer) {
    const platform = c8Platform({ "GET /v2/topology": topology })
    const connection = createC8Connection(
      { id: "c8", baseUrl: CLUSTER },
      { type: "none" },
      {},
      platform,
    )
    const config: EnginePluginConfig = {
      engines: [{ id: "c8", baseUrl: CLUSTER, flavor: "camunda8" }],
      boards: { boards: [boardOver(["c8"])], refused: [] },
    }
    const registry = createEngineRegistry(
      config.engines,
      () => {
        throw new Error("no client for a Camunda 8 engine")
      },
      { contractRuntime: () => c8RuntimeOf(connection) },
    )
    const recording = recordingModuleServer()
    createPlugin(config, registry).register(recording.server)
    return feedPayload<BoardStartData>(
      await recording.tool(ENGINE_BOARD_DATA).call({ board: "both" }),
    )
  }

  it("shows a Camunda 8 engine that fails to say what it is failed, with the hint its failure carries", async () => {
    const refused = await c8BoardOver(() => problem(401, "Unauthorized", "no token"))
    expect(refused.engines).toEqual([
      {
        name: "c8",
        state: "failed",
        failure: {
          code: "unauthorized",
          message:
            "[401 Unauthorized] no token (engine c8) The cluster requires authentication, but " +
            "none is configured: set auth in the engine's profile, its secret in an " +
            "ENGINE_SECRET_* variable.",
        },
      },
    ])
    // A failure without a hint keeps its message as it is.
    const broken = await c8BoardOver(() => problem(500, "INTERNAL", "boom"))
    expect(broken.engines).toEqual([
      {
        name: "c8",
        state: "failed",
        failure: { code: "engineFailure", message: "[500 INTERNAL] boom (engine c8)" },
      },
    ])
  })
})
