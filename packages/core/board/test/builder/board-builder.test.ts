import { RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { BoardBuilder, type TileModel } from "../../src/builder/index.js"
import { BuilderWorld } from "./support/engines.js"

const ORDER = { process: "pulse-order" }
const FAILED = () => Promise.reject(new RuntimeError("engineFailure", "boom"))

function tileOf<Kind extends TileModel["kind"]>(
  rows: readonly (readonly TileModel[])[],
  kind: Kind,
  row = 0,
): Extract<TileModel, { kind: Kind }> {
  const found = rows[row]?.[0]
  if (found?.kind !== kind) {
    throw new Error(`expected a ${kind} in row ${row}`)
  }
  return found as Extract<TileModel, { kind: Kind }>
}

describe("the engines of a board", () => {
  test("are ready with what they are and their totals, failed with the error, or not configured", async () => {
    const refused = new RuntimeError("unauthorized", "HTTP 401")
    const model = await BoardBuilder.build(BuilderWorld.board([], ["shop", "locked", "prod"]), [
      { name: "shop", reads: BuilderWorld.world() },
      {
        name: "locked",
        reads: BuilderWorld.world({ describeEngine: () => Promise.reject(refused) }),
      },
      { name: "prod" },
    ])

    expect(model).toStrictEqual({
      title: "Orders",
      engines: [
        {
          name: "shop",
          state: "ready",
          info: { product: "Fake engine", version: "1.0.0" },
          totals: { running: 5, withIncident: 3 },
        },
        { name: "locked", state: "failed", error: refused },
        { name: "prod", state: "notConfigured" },
      ],
      rows: [],
    })
  })

  test("are ready without totals when the definitions cannot be read", async () => {
    const model = await BoardBuilder.build(BuilderWorld.board([], ["shop"]), [
      { name: "shop", reads: BuilderWorld.world({ listDefinitions: FAILED }) },
    ])

    expect(model.engines).toStrictEqual([
      { name: "shop", state: "ready", info: { product: "Fake engine", version: "1.0.0" } },
    ])
  })

  test("read nothing else from an engine whose probe failed, and each question once", async () => {
    const shop = BuilderWorld.counted("shop", BuilderWorld.world())
    const locked = BuilderWorld.counted(
      "locked",
      BuilderWorld.world({ describeEngine: () => Promise.reject(new Error("gone")) }),
    )
    const counter = { widget: "counter", props: { filter: ORDER } }
    const list = { widget: "instanceList", props: { filter: ORDER } }
    const board = BuilderWorld.board(
      [counter, counter, list, { widget: "incidentSummary" }],
      ["shop", "locked"],
    )

    await BoardBuilder.build(board, [shop.source, locked.source])

    expect(shop.calls).toStrictEqual([
      "describeEngine",
      "listDefinitions",
      "countInstances",
      "searchInstances",
    ])
    expect(locked.calls).toStrictEqual(["describeEngine"])
  })
})

describe("a refused widget", () => {
  test("stays in its place with its problems, and nothing is read for it", async () => {
    const shop = BuilderWorld.counted("shop", BuilderWorld.world())
    const board = BuilderWorld.board(
      [
        { widget: "chart", props: { title: "Throughput" } },
        {
          widget: "counter",
          props: { title: "Ended", filter: { state: "ended", withIncident: true } },
        },
        { widget: "incidentSummary" },
      ],
      ["shop"],
    )

    const model = await BoardBuilder.build(board, [shop.source])

    expect(model.rows.map((row) => row.map((tile) => tile.kind))).toStrictEqual([
      ["refused"],
      ["refused"],
      ["incidentSummary"],
    ])
    expect(model.rows[0]).toStrictEqual([
      {
        kind: "refused",
        widget: "chart",
        title: "Throughput",
        problems: [
          { path: "rows[0].row[0].widget", code: "notOneOf", values: expect.anything() as unknown },
        ],
      },
    ])
    expect(model.rows[1]).toStrictEqual([
      {
        kind: "refused",
        widget: "counter",
        title: "Ended",
        problems: [{ path: "rows[1].row[0].props.filter.withIncident", code: "endedWithIncident" }],
      },
    ])
    expect(shop.calls).toStrictEqual(["describeEngine", "listDefinitions"])
  })

  test("without a widget or a title of its own stays a refused widget without them", async () => {
    const board = BuilderWorld.board([3], ["shop"])

    const model = await BoardBuilder.build(board, [{ name: "shop", reads: BuilderWorld.world() }])

    expect(model.rows).toStrictEqual([
      [{ kind: "refused", problems: [{ path: "rows[0].row[0]", code: "notAnObject" }] }],
    ])
  })

  test("is every widget of a board that names tenants, since no read filters by tenant", async () => {
    const shop = BuilderWorld.counted("shop", BuilderWorld.world())
    const board = BuilderWorld.board(
      [{ widget: "counter", props: { title: "Running" } }, { widget: "incidentList" }, 3],
      ["shop"],
      { tenants: ["acme"] },
    )

    const model = await BoardBuilder.build(board, [shop.source])

    const tenants = [{ path: "tenants", code: "tenantsNotRead" }]
    expect(model.rows).toStrictEqual([
      [{ kind: "refused", widget: "counter", title: "Running", problems: tenants }],
      [{ kind: "refused", widget: "incidentList", problems: tenants }],
      [{ kind: "refused", problems: [{ path: "rows[2].row[0]", code: "notAnObject" }] }],
    ])
    expect(model.engines).toStrictEqual([expect.objectContaining({ name: "shop", state: "ready" })])
    expect(shop.calls).toStrictEqual(["describeEngine", "listDefinitions"])
  })
})

describe("a counter", () => {
  test("sums the counts it read, says how many engines answered and never reads a failure as 0", async () => {
    const board = BuilderWorld.board(
      [{ widget: "counter", props: { filter: ORDER, warnAbove: 2 } }],
      ["shop", "flaky", "prod"],
    )
    const model = await BoardBuilder.build(board, [
      { name: "shop", reads: BuilderWorld.world() },
      { name: "flaky", reads: BuilderWorld.world({ countInstances: FAILED }) },
      { name: "prod" },
    ])

    expect(tileOf(model.rows, "counter")).toStrictEqual({
      kind: "counter",
      widget: board.rows[0]?.[0],
      known: 1,
      total: { count: 3 },
      readings: [
        { engine: "shop", count: { count: 3 }, above: true },
        { engine: "flaky" },
        { engine: "prod" },
      ],
    })
  })

  test("carries a lower bound into its reading and its total, leaves the threshold undecided at or below it and decides nothing without one", async () => {
    const capped = BuilderWorld.world({
      countInstances: () => Promise.resolve({ count: 10, atLeast: true }),
    })
    const board = BuilderWorld.board(
      [5, 10, 20, undefined].map((warnAbove) => ({
        widget: "counter",
        props: { filter: ORDER, warnAbove },
      })),
      ["capped", "shop"],
    )

    const model = await BoardBuilder.build(board, [
      { name: "capped", reads: capped },
      { name: "shop", reads: BuilderWorld.world() },
    ])

    expect([0, 1, 2, 3].map((row) => tileOf(model.rows, "counter", row).readings)).toStrictEqual([
      [
        { engine: "capped", count: { count: 10, atLeast: true }, above: true },
        { engine: "shop", count: { count: 3 } },
      ],
      [
        { engine: "capped", count: { count: 10, atLeast: true }, undecided: true },
        { engine: "shop", count: { count: 3 } },
      ],
      [
        { engine: "capped", count: { count: 10, atLeast: true }, undecided: true },
        { engine: "shop", count: { count: 3 } },
      ],
      [
        { engine: "capped", count: { count: 10, atLeast: true } },
        { engine: "shop", count: { count: 3 } },
      ],
    ])
    expect(tileOf(model.rows, "counter").total).toStrictEqual({ count: 13, atLeast: true })
  })

  test("has no total when no engine answered", async () => {
    const board = BuilderWorld.board([{ widget: "counter" }], ["prod"])

    const model = await BoardBuilder.build(board, [{ name: "prod" }])

    expect(tileOf(model.rows, "counter")).toStrictEqual({
      kind: "counter",
      widget: board.rows[0]?.[0],
      known: 0,
      readings: [{ engine: "prod" }],
    })
  })
})

describe("an instance list", () => {
  test("holds each engine's first page with its total, and no page where it read none", async () => {
    const board = BuilderWorld.board(
      [{ widget: "instanceList", props: { filter: ORDER } }],
      ["shop", "flaky", "uncounted", "prod"],
    )
    const model = await BoardBuilder.build(board, [
      { name: "shop", reads: BuilderWorld.world() },
      { name: "flaky", reads: BuilderWorld.world({ searchInstances: FAILED }) },
      { name: "uncounted", reads: BuilderWorld.world({ countInstances: FAILED }) },
      { name: "prod" },
    ])

    const groups = tileOf(model.rows, "instanceList").groups
    expect(
      groups.map((group) => [group.engine, group.instances?.length, group.total]),
    ).toStrictEqual([
      ["shop", 3, { count: 3 }],
      ["flaky", undefined, undefined],
      ["uncounted", 3, undefined],
      ["prod", undefined, undefined],
    ])
    expect(groups.map((group) => Object.keys(group))).toStrictEqual([
      ["engine", "instances", "total"],
      ["engine"],
      ["engine", "instances"],
      ["engine"],
    ])
    expect(groups[0]?.instances?.map((instance) => instance.businessKey).sort()).toStrictEqual([
      "ORD-1001",
      "ORD-1002",
      "ORD-2001",
    ])
  })
})
