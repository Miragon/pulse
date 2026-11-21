import type { TileData } from "@miragon/pulse-board"
import { afterEach, describe, expect, it } from "vitest"
import { C8_BOARD_ENGINE } from "@miragon/pulse-c8-core/testing"
import { ENGINE_FAILURE } from "../tools/test-support/engine-world.js"
import type { BoardStartData } from "../view-models.board.js"
import { build, closeBuildEngines, DEGRADE, zerosOf } from "./honest-numbers.test-support.js"
import {
  bootBoardOver,
  bootRecordedBoard,
  closeRecordedBoards,
  RECORDED_C8,
  startWithoutSecondaryStorage,
} from "./recorded-board.test-support.js"

afterEach(closeBuildEngines)
afterEach(closeRecordedBoards)

describe.each(Object.entries(DEGRADE))("%s (degrades in place)", (_name, builder) => {
  const places = Object.entries(builder.places)

  it("builds from a healthy engine, reading exactly the declared reads, each figure in its place", async () => {
    const { outcome, reads } = await build(builder)
    expect(outcome.ok ? null : String(outcome.error)).toBeNull()
    expect([...reads].sort()).toEqual(Object.keys(builder.places).sort())
    const data = outcome.ok ? outcome.data : undefined
    for (const [read, place] of places) expect(place(data as never), read).toBeDefined()
  })

  it("shows each failed read in its place and never turns a figure 0", async () => {
    const healthy = await build(builder)
    const zeros = new Set(zerosOf(healthy.outcome.ok ? healthy.outcome.data : undefined))
    const broken = await Promise.all(
      places.map(async ([read, place]) => ({
        read,
        place,
        ...(await build(builder, { read, reply: ENGINE_FAILURE })),
      })),
    )
    for (const { read, place, outcome, reads } of broken) {
      expect(reads, read).toContain(read)
      expect(outcome.ok ? null : String(outcome.error), read).toBeNull()
      if (!outcome.ok) continue
      expect(place(outcome.data as never), read).toBeUndefined()
      expect(
        zerosOf(outcome.data).filter((path) => !zeros.has(path)),
        read,
      ).toEqual([])
    }
  })
})

/** The tile at `row` and `column` of the recorded board, as the kind it is there. */
function tileAt<Kind extends TileData["kind"]>(data: BoardStartData, row: number, column: number) {
  return data.rows[row]?.[column] as Extract<TileData, { kind: Kind }> | undefined
}

const engineOf = (data: BoardStartData) => {
  const [engine] = data.engines
  return engine?.state === "ready" ? engine : undefined
}
const counter = (column: number) => (data: BoardStartData) =>
  tileAt<"counter">(data, 0, column)?.total
const runningOrders = (data: BoardStartData) => tileAt<"instanceList">(data, 1, 0)?.groups[0]
const openIncidents = (data: BoardStartData) =>
  tileAt<"incidentList">(data, 1, 1)?.groups[0]?.incidents
const badges = (data: BoardStartData) => tileAt<"processDiagram">(data, 2, 0)?.badges

/**
 * Where each recorded answer of c8-core's board engine shows on its board, in the recording's
 * order: the cluster's own answers (its topology, its statistics per process, the latest versions,
 * the open incidents of each process with an instance with incident, which the process list
 * counts), the counts of the instance reads, the diagram's (its XML, its element statistics), the
 * open incidents, the running orders' page, the versions the open incidents name and the incidents
 * of the instances the diagram's call activity started.
 */
const C8_PLACES: ReadonlyArray<readonly [string, (data: BoardStartData) => unknown]> = [
  ["the topology: what the engine is", (data) => engineOf(data)?.product],
  ["the instance statistics per process: the engine's totals", (data) => engineOf(data)?.totals],
  ["the latest versions: the engine's totals", (data) => engineOf(data)?.totals],
  ["the open incidents of Dispatch order: the engine's totals", (data) => engineOf(data)?.totals],
  ["the open incidents of Print label: the engine's totals", (data) => engineOf(data)?.totals],
  [
    "the open incidents of Order fulfillment: the engine's totals",
    (data) => engineOf(data)?.totals,
  ],
  ["the running orders' count", (data) => runningOrders(data)?.total],
  ["the orders waiting for review", counter(0)],
  ["the ended orders", counter(2)],
  ["the diagram's XML", badges],
  ["the orders with incident", counter(1)],
  ["the diagram's statistics per element", badges],
  ["the open incidents", openIncidents],
  ["the running orders' page", (data) => runningOrders(data)?.instances],
  ["the version an open incident names (Print label v1)", openIncidents],
  ["the incidents of the instances the call activity started", badges],
  ["the version an open incident names (Order fulfillment v1)", openIncidents],
]

describe("buildBoardData over the server's Camunda 8 wire (degrades in place)", () => {
  const { answers, expected } = C8_BOARD_ENGINE

  it("declares a place for each recorded answer, each shown on the healthy board", () => {
    expect(C8_PLACES).toHaveLength(answers.length)
    for (const [answer, place] of C8_PLACES) {
      expect(place(expected as BoardStartData), answer).toBeDefined()
    }
  })

  it.each(C8_PLACES.map(([answer, place], index) => [answer, place, index] as const))(
    "without %s: the board shows it in its place and never turns a figure 0",
    async (_answer, place, index) => {
      const zeros = new Set(zerosOf(expected))
      const { engine, read } = await bootRecordedBoard(
        RECORDED_C8,
        answers.filter((_, other) => other !== index),
      )
      const board = await read()
      expect(engine.unanswered.length).toBeGreaterThan(0)
      expect(place(board)).toBeUndefined()
      expect(zerosOf(board).filter((path) => !zeros.has(path))).toEqual([])
    },
  )
})

describe("buildBoardData over a Camunda 8 cluster without secondary storage", () => {
  // It says its version, yet answers no search: never a ready engine with empty tiles.
  it("shows the engine failed with the hint the C8 adapter gives, every place empty, never 0", async () => {
    const { engine, read } = await bootBoardOver(RECORDED_C8, await startWithoutSecondaryStorage())
    const board = await read()
    expect(board.engines).toEqual([
      {
        name: C8_BOARD_ENGINE.engine,
        state: "failed",
        failure: {
          code: "misconfigured",
          message:
            "This cluster runs without secondary storage, so Pulse has nothing to read. " +
            `(engine ${C8_BOARD_ENGINE.engine}) Pulse reads the cluster's search API, which ` +
            "needs secondary storage such as Elasticsearch, OpenSearch or a relational database.",
        },
      },
    ])
    // Its definitions read failed, so no tile asked it anything.
    expect(engine.unanswered).toContain("POST /v2/process-definitions/search")
    for (const route of engine.unanswered) {
      expect(route).toMatch(/^POST \/v2\/process-definitions\/(search|statistics\/)/)
    }
    for (const [answer, place] of C8_PLACES) expect(place(board), answer).toBeUndefined()
    expect(zerosOf(board)).toEqual([])
  })
})
