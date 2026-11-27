import { RuntimeError } from "@miragon/pulse-engine-core"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { BoardBuilder, type BoardModel, type TileModel } from "../../src/builder/index.js"
import { BuilderWorld } from "./support/engines.js"

const ORDER = { process: "pulse-order" }
const SILENT = () => new Promise<never>(() => undefined)
const WIDGETS = [
  { widget: "counter", props: { filter: ORDER } },
  { widget: "instanceList", props: { filter: ORDER } },
  { widget: "incidentSummary", props: { groupBy: "engine" } },
  { widget: "incidentList" },
]

interface Building {
  readonly model: Promise<BoardModel>
  settled(): boolean
}

function building(model: Promise<BoardModel>): Building {
  let settled = false
  void model.finally(() => {
    settled = true
  })
  return { model, settled: () => settled }
}

function numbersOf(tile: TileModel | undefined): unknown {
  switch (tile?.kind) {
    case "counter":
      return tile.readings
    case "instanceList":
      return tile.groups.map((group) => [group.engine, group.instances?.length, group.total])
    case "incidentSummary":
      return tile.rows
    case "incidentList":
      return tile.groups.map((group) => [group.engine, group.incidents?.length])
    default:
      return tile?.kind
  }
}

function missed(engine: string, deadlineMs: number): RuntimeError {
  return new RuntimeError(
    "unreachable",
    `${engine} did not answer the board's reads within ${deadlineMs} ms.`,
  )
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("an engine that does not answer within the deadline of a board", () => {
  test("fails as unreachable at 15 seconds, while the other engines' tiles read on time", async () => {
    const shop = BuilderWorld.counted("shop", BuilderWorld.world())
    const stuck = BuilderWorld.counted("stuck", BuilderWorld.world({ describeEngine: SILENT }))
    const board = BuilderWorld.board(WIDGETS, ["shop", "stuck"])

    const build = building(BoardBuilder.build(board, [shop.source, stuck.source]))
    await vi.advanceTimersByTimeAsync(BoardBuilder.ENGINE_DEADLINE_MS - 1)

    expect(build.settled()).toBe(false)
    expect(shop.calls.toSorted()).toStrictEqual([
      "countInstances",
      "describeEngine",
      "listDefinitions",
      "searchIncidents",
      "searchInstances",
    ])
    await vi.advanceTimersByTimeAsync(1)
    const model = await build.model

    expect(model.engines).toStrictEqual([
      expect.objectContaining({ name: "shop", state: "ready" }),
      { name: "stuck", state: "failed", error: missed("stuck", 15_000) },
    ])
    expect(model.rows.map((row) => numbersOf(row[0]))).toStrictEqual([
      [{ engine: "shop", count: { count: 3 } }, { engine: "stuck" }],
      [
        ["shop", 3, { count: 3 }],
        ["stuck", undefined, undefined],
      ],
      [{ engine: "shop", withIncident: 3 }, { engine: "stuck" }],
      [
        ["shop", 2],
        ["stuck", undefined],
      ],
    ])
    expect(stuck.calls).toStrictEqual(["describeEngine"])
  })

  test("that answered what it is keeps its tiles not read, and is asked nothing once the deadline passed", async () => {
    const stuck = BuilderWorld.counted("stuck", BuilderWorld.world({ listDefinitions: SILENT }))
    const board = BuilderWorld.board(WIDGETS, ["stuck"])

    const build = building(BoardBuilder.build(board, [stuck.source]))
    await vi.advanceTimersByTimeAsync(BoardBuilder.ENGINE_DEADLINE_MS)
    const model = await build.model

    expect(model.engines).toStrictEqual([
      { name: "stuck", state: "ready", info: { product: "Fake engine", version: "1.0.0" } },
    ])
    expect(model.rows.map((row) => numbersOf(row[0]))).toStrictEqual([
      [{ engine: "stuck" }],
      [["stuck", undefined, undefined]],
      [{ engine: "stuck" }],
      [["stuck", undefined]],
    ])
    expect(stuck.calls).toStrictEqual(["describeEngine", "listDefinitions"])
  })

  test("fails at the deadline the reader passes, in its words", async () => {
    const stuck = BuilderWorld.counted("stuck", BuilderWorld.world({ countInstances: SILENT }))
    const board = BuilderWorld.board([WIDGETS[0]], ["stuck"])

    const build = building(BoardBuilder.build(board, [stuck.source], { engineDeadlineMs: 1_000 }))
    await vi.advanceTimersByTimeAsync(999)

    expect(build.settled()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const model = await build.model

    expect(model.engines).toStrictEqual([
      {
        name: "stuck",
        state: "ready",
        info: expect.anything() as unknown,
        totals: expect.anything() as unknown,
      },
    ])
    expect(numbersOf(model.rows[0]?.[0])).toStrictEqual([{ engine: "stuck" }])
    expect(stuck.calls).toStrictEqual(["describeEngine", "listDefinitions", "countInstances"])
  })

  test("fails with an error of the contract that names it and the deadline", async () => {
    const stuck = BuilderWorld.world({ describeEngine: SILENT })
    const build = BoardBuilder.build(BuilderWorld.board([], ["stuck"]), [
      { name: "stuck", reads: stuck },
    ])
    await vi.advanceTimersByTimeAsync(BoardBuilder.ENGINE_DEADLINE_MS)
    const [engine] = (await build).engines

    expect(engine?.state === "failed" ? engine.error : engine).toMatchObject({
      failure: "unreachable",
      message: "stuck did not answer the board's reads within 15000 ms.",
      hint: undefined,
    })
  })
})

describe("the deadline of a board", () => {
  test("leaves no timer behind once every engine answered", async () => {
    const board = BuilderWorld.board(WIDGETS, ["shop", "prod"])

    await BoardBuilder.build(board, [
      { name: "shop", reads: BuilderWorld.world() },
      { name: "prod" },
    ])

    expect(vi.getTimerCount()).toBe(0)
  })

  test("leaves no timer behind when a read fails", async () => {
    const failing = BuilderWorld.world({
      describeEngine: () => Promise.reject(new RuntimeError("unauthorized", "HTTP 401")),
    })

    const model = await BoardBuilder.build(BuilderWorld.board(WIDGETS, ["shop"]), [
      { name: "shop", reads: failing },
    ])

    expect(model.engines).toStrictEqual([
      { name: "shop", state: "failed", error: new RuntimeError("unauthorized", "HTTP 401") },
    ])
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe("the deadline a reader passes", () => {
  test.each([0, 0.5, -1, Number.NaN, -Infinity, 2_147_483_648])(
    "of %s ms is refused with a RangeError that names the option, before any read",
    async (engineDeadlineMs) => {
      const shop = BuilderWorld.counted("shop", BuilderWorld.world())

      const build = BoardBuilder.build(BuilderWorld.board(WIDGETS, ["shop"]), [shop.source], {
        engineDeadlineMs,
      })

      await expect(build).rejects.toStrictEqual(
        new RangeError(
          `engineDeadlineMs must be from 1 to 2147483647 ms, or Infinity for no deadline, not ${engineDeadlineMs}.`,
        ),
      )
      expect(shop.calls).toStrictEqual([])
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  test.each([1, 2_147_483_647])("of %s ms is taken as it is", async (engineDeadlineMs) => {
    const build = BoardBuilder.build(
      BuilderWorld.board(WIDGETS, ["shop"]),
      [{ name: "shop", reads: BuilderWorld.world() }],
      { engineDeadlineMs },
    )

    expect(vi.getTimerCount()).toBe(1)
    const [engine] = (await build).engines
    expect(engine?.state).toBe("ready")
  })

  test("of Infinity sets none: an engine that answers a day later still reads", async () => {
    let answer!: () => void
    const answered = new Promise<void>((resolve) => {
      answer = resolve
    })
    const world = BuilderWorld.world()
    const slow = BuilderWorld.world({
      describeEngine: async () => {
        await answered
        return world.describeEngine()
      },
    })
    const build = building(
      BoardBuilder.build(BuilderWorld.board(WIDGETS, ["slow"]), [{ name: "slow", reads: slow }], {
        engineDeadlineMs: Infinity,
      }),
    )

    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(build.settled()).toBe(false)
    answer()
    const model = await build.model

    expect(model.engines.map((engine) => engine.state)).toStrictEqual(["ready"])
    expect(numbersOf(model.rows[0]?.[0])).toStrictEqual([{ engine: "slow", count: { count: 3 } }])
  })
})
