import { BoardParser } from "@miragon/pulse-board"
import { BoardBuilder, BoardJson, type BoardModel } from "@miragon/pulse-board/builder"
import { BpmnProcessId, DefinitionId, ElementId, RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import type { BoardEngine } from "../../src/core/boards/board-engine.js"
import { BoardPanel } from "../../src/core/boards/board-panel.js"
import { BoardViews } from "../../src/core/boards/board-views.js"
import { EngineLane } from "../../src/core/refresh/engine-lane.js"
import { SharedDefinitions } from "../../src/core/refresh/shared-definitions.js"
import type { BoardTile } from "../../src/core/protocol/index.js"
import { badgeOf, boardFixture, stubbed, summary } from "./support/board-fixture.js"

const SOURCE = {
  fileName: "shop.board.json",
  asOf: new Date("2026-10-26T09:00:00Z"),
  problems: [],
  notes: [],
}

function configured(name: string): BoardEngine {
  const runtime = stubbed({ getDiagramXml: () => Promise.resolve(undefined) })
  return {
    name,
    configured: true,
    badge: badgeOf(name),
    runtime,
    definitions: new SharedDefinitions(runtime, new EngineLane()),
  }
}

describe("the view of a board's model", () => {
  test("hands the builder the reads of each configured engine and none of the others", () => {
    const views = new BoardViews([configured("shop"), { name: "prod", configured: false }])

    expect(views.sources().map((source) => [source.name, source.reads !== undefined])).toEqual([
      ["shop", true],
      ["prod", false],
    ])
  })

  test("draws no diagram the engine has no drawing for, and reads an engine it does not know as not configured", async () => {
    const views = new BoardViews([configured("shop")])
    const latest = {
      id: DefinitionId("order:1"),
      bpmnProcessId: BpmnProcessId("order"),
      version: 1,
    }
    const model: BoardModel = {
      title: "Orders",
      engines: [{ name: "gone", state: "ready", info: { product: "Engine", version: "7.24" } }],
      rows: [
        [
          {
            kind: "processDiagram",
            widget: { widget: "processDiagram", engines: ["shop"], process: "order" },
            engine: "shop",
            latest,
            badges: [
              {
                elementId: ElementId("Task"),
                active: 1,
                incidents: 0,
                incidentsInCalledInstances: 0,
              },
            ],
          },
        ],
      ],
    }

    const view = await views.of(model, SOURCE)

    expect(view.engines).toEqual([{ name: "gone", state: "notConfigured" }])
    expect(view.rows[0]?.[0]).toMatchObject({ kind: "processDiagram", engine: "shop", latest })
    expect(view.rows[0]?.[0]).not.toHaveProperty("diagramXml")
  })

  test("reads the diagram once for the numbers and the drawing", async () => {
    const xml = '<bpmn:process id="order"><bpmn:userTask id="Task_Pay"/></bpmn:process>'
    const runtime = stubbed({
      listDefinitions: () => Promise.resolve([summary("order", 1, 0)]),
      getDiagramXml: () => Promise.resolve(xml),
      getElementStatistics: () =>
        Promise.resolve([
          {
            elementId: ElementId("Task_Pay"),
            active: 1,
            incidents: 0,
            incidentsInCalledInstances: 0,
          },
        ]),
    })
    const diagram = { widget: "processDiagram", props: { engines: ["shop"], process: "order" } }
    const fixture = boardFixture(
      { title: "Orders", engines: ["shop"], rows: [{ row: [diagram] }] },
      [{ name: "shop", runtime }],
    )

    await new BoardPanel(fixture.context).handle({ type: "ready" })

    expect(fixture.calls.get("shop")?.filter((call) => call === "getDiagramXml")).toHaveLength(1)
    expect(fixture.view().rows[0]?.[0]).toMatchObject({ diagramXml: xml })
  })
})

describe("the board a webview gets", () => {
  const ORDER = { process: "pulse-order" }
  const WORLD = {
    title: "Orders",
    engines: ["shop", "locked", "prod"],
    layout: "wide",
    rows: [
      { row: [{ widget: "counter", props: { filter: ORDER, warnAbove: 2 } }] },
      { row: [{ widget: "instanceList", props: { filter: ORDER, engines: ["shop"] } }] },
      { row: [{ widget: "incidentSummary" }] },
      { row: [{ widget: "processDiagram", props: { engines: ["shop"], process: "pulse-order" } }] },
      { row: [{ widget: "incidentList", props: { engines: ["shop"] } }] },
      { row: [{ widget: "chart", props: { title: "Throughput" } }] },
    ],
  }
  const LOCKED = { describeEngine: () => Promise.reject(new RuntimeError("unauthorized", "401")) }
  const EDITORS_ADD: ReadonlySet<string> = new Set(["targets", "diagramXml"])

  function dataOf(value: unknown): unknown {
    return JSON.parse(
      JSON.stringify(value, (key, field: unknown) => (EDITORS_ADD.has(key) ? undefined : field)),
    )
  }

  async function built() {
    const parsed = BoardParser.parse(JSON.stringify(WORLD))
    if ("problems" in parsed) {
      throw new Error("the world's board must parse")
    }
    const model = await BoardBuilder.build(parsed.board, [
      { name: "shop", reads: stubbed({}) },
      { name: "locked", reads: stubbed(LOCKED) },
      { name: "prod" },
    ])
    return BoardJson.of(model, { failureOf: () => ({ code: "failed" }), notes: parsed.notes })
  }

  async function shown() {
    const fixture = boardFixture(WORLD, [
      { name: "shop", runtime: stubbed({}) },
      { name: "locked", runtime: stubbed(LOCKED) },
      { name: "prod" },
    ])
    await new BoardPanel(fixture.context).handle({ type: "ready" })
    return fixture.view()
  }

  test("holds the tiles and notes of the board's JSON form over the kit's world", async () => {
    const [data, view] = await Promise.all([built(), shown()])

    expect(view.title).toBe(data.title)
    expect(dataOf(view.rows)).toEqual(data.rows)
    expect(dataOf(view.notes)).toEqual(data.notes)
    expect(view.rows.flat().map((tile) => tile.kind)).toEqual([
      "counter",
      "instanceList",
      "incidentSummary",
      "processDiagram",
      "incidentList",
      "refused",
    ])
  })

  test("adds the targets a click opens and the drawing, and leaves each problem a code", async () => {
    const view = await shown()
    const tiles = view.rows.flat()
    const tile = <Kind extends BoardTile["kind"]>(kind: Kind) =>
      tiles.find((found): found is Extract<BoardTile, { kind: Kind }> => found.kind === kind)
    const refused = tile("refused")?.problems ?? []

    expect(tile("counter")?.targets).toEqual(
      ["shop", "locked", "prod"].map((engine) => ({
        engine,
        bpmnProcessId: "pulse-order",
        filter: { scope: "running" },
      })),
    )
    expect(tile("incidentSummary")?.targets).toHaveLength(
      tile("incidentSummary")?.rows.length ?? -1,
    )
    expect(tile("processDiagram")?.diagramXml).toContain("pulse-order")
    expect(refused.map(({ code }) => code)).toEqual(["notOneOf"])
    expect(view.notes.map(({ code }) => code)).toEqual(["ignoredKey"])
  })

  test("words a failed engine from the error its probe threw, any error, since no editor reads the JSON form's engines", async () => {
    const odd = stubbed({ describeEngine: () => Promise.reject(new Error("boom")) })
    const fixture = boardFixture(
      { title: "Odd", engines: ["odd"], rows: [{ row: [{ widget: "incidentSummary" }] }] },
      [{ name: "odd", runtime: odd }],
    )

    await new BoardPanel(fixture.context).handle({ type: "ready" })

    expect(fixture.view().engines).toEqual([
      {
        name: "odd",
        state: "failed",
        badge: badgeOf("odd"),
        problem: { title: "Loading from odd failed.", detail: "boom", canEditConnection: false },
      },
    ])
  })
})
