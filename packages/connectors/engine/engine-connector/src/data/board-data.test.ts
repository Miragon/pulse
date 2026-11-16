/**
 * The board feed end to end: the module's configuration (ENGINES_JSON, ENGINE_BOARDS_DIR), the
 * plugin, and `engine_board_data` over the fake engine's world. Its floor (the build kept per
 * caller and board) is board-data.floor.test.ts's; how each failed read degrades, the
 * honest-numbers table's.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { z } from "zod"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { BoardProblems } from "@miragon/pulse-board"
import { engineModule } from "../module.js"
import { ENGINE_BOARD_DATA } from "../tool-names.js"
import { feedPayload } from "../tools/test-support/feed-payload.js"
import { worldReply } from "../tools/test-support/engine-world.js"
import {
  type FakeEngine,
  type FakeRoutes,
  startFakeEngine,
} from "../tools/test-support/fake-engine.js"
import type { BoardStartData } from "../view-models.board.js"

const engines: FakeEngine[] = []
const dirs: string[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

async function fakeEngine(routes: FakeRoutes = {}): Promise<FakeEngine> {
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

/** The refusal a call to the camunda8 profile gets, as engine_status gives it. */
const C8_REFUSAL =
  '[ENGINE_PROFILE_REFUSED] Engine "c8" is configured, but its profile cannot be used: ' +
  "This server does not speak the API of this flavor: it reads camunda7, cibseven and " +
  "operaton. Ask whoever runs this server to fix it."

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
        c8: { url: c8.baseUrl, flavor: "camunda8" },
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
