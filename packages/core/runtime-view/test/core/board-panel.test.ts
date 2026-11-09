import { BpmnProcessId, InstanceId, RuntimeError } from "../../src/contract/index.js"
import { describe, expect, test } from "vitest"
import { BoardPanel } from "../../src/core/boards/board-panel.js"
import type { BoardTile } from "../../src/core/protocol/index.js"
import {
  badgeOf,
  boardFixture,
  deferred,
  instance,
  stubbed,
  summary,
} from "./support/board-fixture.js"

const SHOP = stubbed({
  describeEngine: () => Promise.resolve({ product: "Engine", version: "7.24" }),
  listDefinitions: () =>
    Promise.resolve([
      summary("order", 12, 3, "Order fulfillment"),
      summary("shipment", 4, 5),
      summary("audit", 1, 0),
    ]),
  countInstances: (filter) => Promise.resolve(filter.withIncident === true ? 3 : 12),
  searchInstances: () =>
    Promise.resolve({ items: [instance("i-1", "order", "ORD-1"), instance("i-2", "order")] }),
})

const BILLING = stubbed({
  describeEngine: () => Promise.resolve({ product: "Engine", version: "7.23" }),
  listDefinitions: () => Promise.resolve([summary("order", 2, 1)]),
  countInstances: () => Promise.resolve(2),
  searchInstances: () => Promise.resolve({ items: [instance("b-1", "order", "ORD-9")] }),
})

const LOCKED = stubbed({
  describeEngine: () => Promise.reject(new RuntimeError("unauthorized", "HTTP 401")),
})

const FLAKY = stubbed({
  describeEngine: () => Promise.resolve({ product: "Engine", version: "7.22" }),
  listDefinitions: () => Promise.reject(new RuntimeError("engineFailure", "boom")),
  countInstances: () => Promise.reject(new RuntimeError("engineFailure", "boom")),
  searchInstances: () => Promise.reject(new RuntimeError("engineFailure", "boom")),
})

const ORDER = { process: "order" }

function board(rows: unknown[], engines = ["shop", "billing", "prod"]) {
  return { title: "Payments", engines, rows: rows.map((row) => ({ row: [row] })) }
}

function tileOf<Kind extends BoardTile["kind"]>(
  fixture: ReturnType<typeof boardFixture>,
  kind: Kind,
  row = 0,
): Extract<BoardTile, { kind: Kind }> {
  const found = fixture.view().rows[row]?.[0]
  if (found?.kind !== kind) {
    throw new Error(`expected a ${kind} in row ${row}`)
  }
  return found as Extract<BoardTile, { kind: Kind }>
}

const ENGINES = [
  { name: "shop", runtime: SHOP },
  { name: "billing", runtime: BILLING },
  { name: "prod" },
]

describe("a board across engines", () => {
  test("counts per engine, sums what it could read and marks the threshold per engine", async () => {
    const counter = { widget: "counter", props: { filter: ORDER, warnAbove: 10 } }
    const fixture = boardFixture(board([counter]), ENGINES)

    await new BoardPanel(fixture.context).handle({ type: "ready" })

    const target = { filter: { scope: "running" }, bpmnProcessId: "order" }
    expect(tileOf(fixture, "counter")).toEqual({
      kind: "counter",
      title: "Running instances of order",
      total: 14,
      known: 2,
      warnAbove: 10,
      entries: [
        { engine: "shop", count: 12, above: true, target: { engine: "shop", ...target } },
        { engine: "billing", count: 2, target: { engine: "billing", ...target } },
        { engine: "prod", target: { engine: "prod", ...target } },
      ],
    })
    expect(fixture.view().engines).toEqual([
      {
        name: "shop",
        state: "ready",
        badge: badgeOf("shop"),
        product: "Engine 7.24",
        running: 17,
        withIncident: 8,
      },
      {
        name: "billing",
        state: "ready",
        badge: badgeOf("billing"),
        product: "Engine 7.23",
        running: 2,
        withIncident: 1,
      },
      { name: "prod", state: "notConfigured" },
    ])
  })

  test("offers no click where the definition panel cannot show the same instances", async () => {
    const without = { widget: "counter", props: { filter: { ...ORDER, withIncident: false } } }
    const withIncident = { widget: "counter", props: { filter: { ...ORDER, withIncident: true } } }
    const fixture = boardFixture(board([without, withIncident], ["shop"]), [
      { name: "shop", runtime: SHOP },
    ])

    await new BoardPanel(fixture.context).handle({ type: "ready" })

    expect(tileOf(fixture, "counter").entries).toEqual([{ engine: "shop", count: 12 }])
    expect(tileOf(fixture, "counter", 1)).toMatchObject({ incident: true, total: 3 })
  })

  test("reads nothing else from an engine whose probe failed and says why once", async () => {
    const counter = { widget: "counter", props: { filter: ORDER } }
    const fixture = boardFixture(board([counter], ["shop", "locked"]), [
      { name: "shop", runtime: SHOP },
      { name: "locked", runtime: LOCKED },
    ])

    await new BoardPanel(fixture.context).handle({ type: "ready" })

    expect(fixture.calls.get("locked")).toEqual(["describeEngine"])
    expect(fixture.view().engines[1]).toEqual({
      name: "locked",
      state: "failed",
      badge: badgeOf("locked"),
      problem: {
        title: "locked rejected the credentials.",
        detail: "HTTP 401",
        canEditConnection: true,
        needsCredentials: true,
      },
    })
    expect(tileOf(fixture, "counter")).toMatchObject({ total: 12, known: 1 })
  })

  test("shows a dash, never a zero, when a read fails after the probe", async () => {
    const counter = { widget: "counter", props: { title: "Stuck", filter: ORDER } }
    const fixture = boardFixture(board([counter], ["flaky"]), [{ name: "flaky", runtime: FLAKY }])

    await new BoardPanel(fixture.context).handle({ type: "ready" })

    expect(tileOf(fixture, "counter")).toEqual({
      kind: "counter",
      title: "Stuck",
      known: 0,
      entries: [{ engine: "flaky", target: expect.anything() as unknown }],
    })
    expect(fixture.view().engines[0]).toEqual({
      name: "flaky",
      state: "ready",
      badge: badgeOf("flaky"),
      product: "Engine 7.22",
    })
  })

  test("reads the same question once per engine however many widgets ask it", async () => {
    const counter = { widget: "counter", props: { filter: ORDER } }
    const list = { widget: "instanceList", props: { filter: ORDER } }
    const incidents = { widget: "incidentSummary" }
    const fixture = boardFixture(board([counter, counter, list, incidents], ["shop"]), [
      { name: "shop", runtime: SHOP },
    ])

    await new BoardPanel(fixture.context).handle({ type: "ready" })

    expect(fixture.calls.get("shop")).toEqual([
      "describeEngine",
      "listDefinitions",
      "countInstances",
      "searchInstances",
    ])
  })

  test("lists the first page of every engine in one table, with each engine's total", async () => {
    const list = { widget: "instanceList", props: { filter: ORDER, columns: ["businessKey"] } }
    const fixture = boardFixture(board([list]), [
      ...ENGINES.slice(0, 2),
      { name: "prod", runtime: LOCKED },
    ])

    await new BoardPanel(fixture.context).handle({ type: "ready" })

    const shown = tileOf(fixture, "instanceList")
    expect(shown.columns).toEqual(["engine", "businessKey"])
    expect(shown.groups.map((group) => [group.engine, group.total, group.unavailable])).toEqual([
      ["shop", 12, undefined],
      ["billing", 2, undefined],
      ["prod", undefined, true],
    ])
    expect(shown.groups[0]?.rows[0]).toEqual({
      engine: "shop",
      id: "i-1",
      shortId: "i-1",
      processName: "Order fulfillment",
      bpmnProcessId: "order",
      version: 2,
      state: "Running",
      hasIncident: false,
      businessKey: "ORD-1",
      startedAt: "2026-10-26T08:00:00.000Z",
    })
  })

  test("keeps the columns as written when the widget reads one engine", async () => {
    const list = {
      widget: "instanceList",
      props: { engines: ["shop"], filter: ORDER, columns: ["state"] },
    }
    const flaky = { widget: "instanceList", props: { filter: ORDER } }
    const fixture = boardFixture(board([list, flaky], ["shop", "flaky"]), [
      { name: "shop", runtime: SHOP },
      { name: "flaky", runtime: FLAKY },
    ])

    await new BoardPanel(fixture.context).handle({ type: "ready" })

    expect(tileOf(fixture, "instanceList").columns).toEqual(["state"])
    expect(tileOf(fixture, "instanceList", 1).groups[1]).toEqual({
      engine: "flaky",
      rows: [],
      unavailable: true,
    })
  })

  test("sums instances with incident per engine or lists them per process, most first", async () => {
    const byEngine = { widget: "incidentSummary", props: { groupBy: "engine" } }
    const byProcess = { widget: "incidentSummary", props: { title: "Where it fails" } }
    const fixture = boardFixture(board([byEngine, byProcess]), ENGINES)

    await new BoardPanel(fixture.context).handle({ type: "ready" })

    const withIncident = { scope: "withIncident" }
    expect(tileOf(fixture, "incidentSummary")).toEqual({
      kind: "incidentSummary",
      title: "Instances with incident",
      groupBy: "engine",
      total: 9,
      known: 2,
      engines: 3,
      rows: [
        {
          engine: "shop",
          label: "shop",
          withIncident: 8,
          target: { engine: "shop", filter: withIncident },
        },
        {
          engine: "billing",
          label: "billing",
          withIncident: 1,
          target: { engine: "billing", filter: withIncident },
        },
        { engine: "prod", label: "prod", target: { engine: "prod", filter: withIncident } },
      ],
    })
    expect(
      tileOf(fixture, "incidentSummary", 1).rows.map((row) => [
        row.engine,
        row.label,
        row.withIncident,
      ]),
    ).toEqual([
      ["shop", "shipment", 5],
      ["shop", "Order fulfillment", 3],
      ["billing", "order", 1],
    ])
  })

  test("says nothing about totals when no engine answered", async () => {
    const fixture = boardFixture(board([{ widget: "incidentSummary" }], ["prod"]), [
      { name: "prod" },
    ])

    await new BoardPanel(fixture.context).handle({ type: "ready" })

    expect(tileOf(fixture, "incidentSummary")).toEqual({
      kind: "incidentSummary",
      title: "Instances with incident",
      groupBy: "process",
      known: 0,
      engines: 1,
      rows: [],
    })
  })
})

describe("a board file that changes", () => {
  const COUNTER = { widget: "counter", props: { filter: ORDER } }

  test("shows what is wrong when the file was never valid", async () => {
    const fixture = boardFixture("{", ENGINES)

    await new BoardPanel(fixture.context).handle({ type: "ready" })

    expect(fixture.view()).toEqual({
      kind: "board",
      asOf: "2026-10-26T09:00:00.000Z",
      title: "shop.board.json",
      fileName: "shop.board.json",
      engines: [],
      rows: [],
      problems: [{ path: "(file)", reason: "is not valid JSON" }],
    })
  })

  test("keeps the last valid board under the problems of a broken save", async () => {
    const fixture = boardFixture(board([COUNTER], ["shop"]), [{ name: "shop", runtime: SHOP }])
    const panel = new BoardPanel(fixture.context)
    await panel.handle({ type: "ready" })

    fixture.content = JSON.stringify({ ...board([COUNTER], ["shop"]), title: "" })
    await panel.handle({ type: "refresh" })

    expect(fixture.view()).toMatchObject({
      title: "Payments",
      rows: [[{ kind: "counter", total: 12 }]],
      problems: [{ path: "title", reason: "must be a text that is not empty" }],
    })
  })

  test("says when the file cannot be read", async () => {
    const fixture = boardFixture("", [])
    fixture.content = new Error("gone")

    await new BoardPanel(fixture.context).handle({ type: "ready" })

    expect(fixture.view().problems).toEqual([{ path: "(file)", reason: "could not be read" }])
  })

  test("marks a refresh while it reads and shows the old board until then", async () => {
    const fixture = boardFixture(board([COUNTER], ["shop"]), [{ name: "shop", runtime: SHOP }])
    const panel = new BoardPanel(fixture.context)
    await panel.handle({ type: "ready" })

    await panel.handle({ type: "refresh" })

    expect(fixture.states.map((state) => state.status === "ready" && state.refreshing)).toEqual([
      false,
      true,
      false,
    ])
  })

  test("shows the board again without reading when the webview comes back", async () => {
    const fixture = boardFixture(board([COUNTER], ["shop"]), [{ name: "shop", runtime: SHOP }])
    const panel = new BoardPanel(fixture.context)
    await panel.handle({ type: "ready" })

    await panel.handle({ type: "ready" })

    expect(fixture.calls.get("shop")).toHaveLength(3)
    expect(fixture.states).toHaveLength(2)
  })

  test("lets the latest read win, even when an older read answers last", async () => {
    const fixture = boardFixture("", [{ name: "shop", runtime: SHOP }])
    const older = deferred<string>()
    const newer = deferred<string>()
    const reads = [older.promise, newer.promise]
    const panel = new BoardPanel({ ...fixture.context, read: () => reads.shift()! })
    const first = panel.handle({ type: "ready" })
    const second = panel.handle({ type: "refresh" })

    newer.resolve(JSON.stringify({ ...board([COUNTER], ["shop"]), title: "Newer" }))
    await second
    older.resolve(JSON.stringify({ ...board([COUNTER], ["shop"]), title: "Older" }))
    await first

    expect(fixture.view().title).toBe("Newer")
  })

  test("keeps the latest valid board for later broken saves, not an older one", async () => {
    const fixture = boardFixture("", [{ name: "shop", runtime: SHOP }])
    const older = deferred<string>()
    const contents = [
      older.promise,
      Promise.resolve(JSON.stringify({ ...board([COUNTER], ["shop"]), title: "Newer" })),
      Promise.resolve("{"),
    ]
    const panel = new BoardPanel({ ...fixture.context, read: () => contents.shift()! })
    const first = panel.handle({ type: "ready" })
    await panel.handle({ type: "refresh" })
    older.resolve(JSON.stringify({ ...board([COUNTER], ["shop"]), title: "Older" }))
    await first

    await panel.handle({ type: "refresh" })

    expect(fixture.view()).toMatchObject({ title: "Newer", problems: [{ path: "(file)" }] })
  })

  test("publishes nothing once closed", async () => {
    const fixture = boardFixture(board([COUNTER], ["shop"]), [{ name: "shop", runtime: SHOP }])
    const panel = new BoardPanel(fixture.context)
    await panel.handle({ type: "ready" })
    const published = fixture.states.length

    panel.attend()
    panel.nudge()
    panel.dispose()
    await panel.handle({ type: "refresh" })

    expect(fixture.states).toHaveLength(published)
  })
})

describe("navigating from a board", () => {
  const LIST = { widget: "instanceList", props: { filter: ORDER } }
  const COUNTER = { widget: "counter", props: { filter: ORDER } }

  async function opened() {
    const fixture = boardFixture(board([LIST, COUNTER], ["shop", "locked", "prod"]), [
      { name: "shop", runtime: SHOP },
      { name: "locked", runtime: LOCKED },
      { name: "prod" },
    ])
    const panel = new BoardPanel(fixture.context)
    await panel.handle({ type: "ready" })
    return { fixture, panel }
  }

  test("opens an instance it shows on the engine it came from, and nothing else", async () => {
    const { fixture, panel } = await opened()

    await panel.handle({
      type: "openBoardInstance",
      engine: "shop",
      instanceId: "i-2",
      toSide: true,
    })
    await panel.handle({
      type: "openBoardInstance",
      engine: "locked",
      instanceId: "i-2",
      toSide: false,
    })
    await panel.handle({
      type: "openBoardInstance",
      engine: "shop",
      instanceId: "i-404",
      toSide: false,
    })

    expect(fixture.navigation.openInstance.mock.calls).toEqual([
      ["shop", InstanceId("i-2"), { toSide: true }],
    ])
  })

  test("opens a process it counts or lists with the widget's filter", async () => {
    const { fixture, panel } = await opened()
    const filter = { scope: "running" } as const

    await panel.handle({
      type: "openBoardProcess",
      engine: "shop",
      bpmnProcessId: "order",
      filter,
      toSide: false,
    })
    await panel.handle({
      type: "openBoardProcess",
      engine: "shop",
      bpmnProcessId: "audit",
      filter,
      toSide: false,
    })
    await panel.handle({
      type: "openBoardProcess",
      engine: "shop",
      bpmnProcessId: "order",
      filter: { scope: "all" },
      toSide: false,
    })

    expect(fixture.navigation.openDefinition.mock.calls).toEqual([
      ["shop", BpmnProcessId("order"), filter, { toSide: false }],
    ])
  })

  test("opens the processes of a configured engine and asks for credentials only where they were refused", async () => {
    const { fixture, panel } = await opened()

    await panel.handle({ type: "openBoardEngine", engine: "locked", toSide: false })
    await panel.handle({ type: "openBoardEngine", engine: "prod", toSide: false })
    await panel.handle({ type: "setBoardCredentials", engine: "locked" })
    await panel.handle({ type: "setBoardCredentials", engine: "shop" })

    expect(fixture.navigation.openEngine.mock.calls).toEqual([["locked", { toSide: false }]])
    expect(fixture.navigation.setCredentials.mock.calls).toEqual([["locked"]])
  })

  test("opens the board file and the engines file", async () => {
    const { fixture, panel } = await opened()

    await panel.handle({ type: "openBoardFile" })
    await panel.handle({ type: "editConnection" })

    expect(fixture.navigation.openFile).toHaveBeenCalledOnce()
    expect(fixture.navigation.editEngines).toHaveBeenCalledOnce()
  })

  test("ignores clicks before anything is shown", async () => {
    const fixture = boardFixture(board([LIST], ["shop"]), [{ name: "shop", runtime: SHOP }])
    const panel = new BoardPanel(fixture.context)

    await panel.handle({ type: "openBoardEngine", engine: "shop", toSide: false })

    expect(fixture.navigation.openEngine).not.toHaveBeenCalled()
  })
})
