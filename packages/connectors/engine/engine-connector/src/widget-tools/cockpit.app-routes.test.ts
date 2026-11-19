import { afterEach, describe, expect, it } from "vitest"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import type { BoardFiles } from "../board-files.js"
import { worldBoard } from "../data/honest-numbers.test-support.js"
import { createPlugin } from "../plugin.js"
import { ENGINE_LIST_ENGINES } from "../tool-names.js"
import {
  ALL,
  closeFakeEngines,
  cockpitOf,
  cockpitOn,
  dataOf,
  factsOf,
  textOf,
  THREE,
} from "./cockpit.test-support.js"

/** `engine_open_cockpit`'s app routes: a board and the landing, which open no single engine. */

afterEach(closeFakeEngines)

describe("engine_open_cockpit: a board, an app route", () => {
  const ORDERS: BoardFiles = { boards: [worldBoard()], refused: [] }

  it("opens without an engine, reads the engines the board names, and hands the model its facts", async () => {
    const { handler, requests } = await cockpitOn([{ id: "fake" }, { id: "other" }], {
      boards: { boards: [worldBoard()], refused: [] },
    })
    const result = await handler({ view: "board", board: "orders" })
    expect(result.isError).toBeUndefined()
    expect(dataOf(result)).toMatchObject({
      engineId: null,
      engines: [
        { id: "fake", environment: "default" },
        { id: "other", environment: "default" },
      ],
      start: {
        view: { section: "board", board: "orders" },
        data: { title: "Orders", engines: [{ name: "fake", state: "ready" }] },
      },
    })
    const facts = factsOf(result)
    expect(facts).toMatchObject({ view: "board", board: "orders", title: "Orders" })
    expect(facts).not.toHaveProperty("engine")
    expect(requests.length).toBeGreaterThan(0)
    // No payload carries BPMN XML or an engine's REST address.
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain("<?xml")
    expect(serialized).not.toContain("127.0.0.1")
  })

  it("opens with several engines and no default, where an engine view would need one", async () => {
    const { handler } = await cockpitOn([{ id: "fake" }, { id: "other" }], { boards: ORDERS })
    expect((await handler({ view: "board", board: "orders" })).isError).toBeUndefined()
  })

  it("an unknown board is a tool error that lists the boards", async () => {
    const { handler } = await cockpitOn([{ id: "fake" }], { boards: ORDERS })
    const result = await handler({ view: "board", board: "shipping" })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('[UNKNOWN_BOARD] Unknown board id "shipping". Boards: orders.')
  })

  it("on a server without boards, a board is a tool error that says so", async () => {
    const { handler } = await cockpitOn([{ id: "fake" }])
    const result = await handler({ view: "board", board: "orders" })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      '[UNKNOWN_BOARD] Unknown board id "orders": this server shows no board.',
    )
  })
})

describe("engine_open_cockpit: the landing, an app route without a feed", () => {
  const PROBLEM = { path: "$.rows", code: "missing" } as const
  const BOARDS: BoardFiles = {
    boards: [worldBoard()],
    refused: [{ id: "broken", file: "broken.board.json", problems: [PROBLEM] }],
  }

  it("opens on no engine and reads none: the boards the engine list names, the ids as facts", async () => {
    const { handler, requests } = await cockpitOn(THREE, { boards: BOARDS })
    const result = await handler({ view: "landing" })
    expect(result.isError).toBeUndefined()
    expect(dataOf(result)).toEqual({
      engineId: null,
      engines: ALL,
      start: {
        view: { section: "landing" },
        data: {
          boards: [{ id: "orders", title: "Orders", engines: ["fake"] }],
          refusedBoards: [{ id: "broken", problems: 1 }],
        },
      },
    })
    expect(textOf(result)).toBe(
      '{"view":"landing","engines":["alpha","beta","gamma"],"boards":["orders"],"refusedBoards":["broken"]}',
    )
    expect(requests).toEqual([])
  })

  it("opens with one engine and with a default engine too, which an omitted view would open", async () => {
    const one = await cockpitOn([{ id: "solo" }], { boards: BOARDS })
    expect(dataOf(await one.handler({ view: "landing" }))).toMatchObject({
      engineId: null,
      start: { view: { section: "landing" } },
    })
    const withDefault = await cockpitOn(THREE, { defaultEngineId: "gamma" })
    expect(dataOf(await withDefault.handler({ view: "landing" }))).toMatchObject({
      engineId: null,
    })
  })

  it("on a server without boards, its start names no board and its facts the engines alone", async () => {
    const { handler } = await cockpitOn([{ id: "solo" }])
    const result = await handler({ view: "landing" })
    expect(dataOf(result)).toMatchObject({ start: { view: { section: "landing" }, data: {} } })
    expect(textOf(result)).toBe('{"view":"landing","engines":["solo"]}')
  })

  it("its start is what engine_list_engines lists of the boards", async () => {
    const recording = recordingModuleServer()
    createPlugin({
      engines: [{ id: "fake", baseUrl: "http://fake.invalid/engine-rest" }],
      boards: BOARDS,
    }).register(recording.server)
    const listed = JSON.parse(textOf(await recording.tool(ENGINE_LIST_ENGINES).call({}))) as {
      boards: unknown
      refusedBoards: unknown
    }
    const result = await cockpitOf(recording).handler({ view: "landing" })
    expect((dataOf(result).start as { data: unknown }).data).toEqual({
      boards: listed.boards,
      refusedBoards: listed.refusedBoards,
    })
  })
})
