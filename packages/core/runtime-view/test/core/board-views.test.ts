import type { BoardModel } from "@miragon/pulse-board/builder"
import { BpmnProcessId, DefinitionId, ElementId } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import type { BoardEngine } from "../../src/core/boards/board-engine.js"
import { BoardPanel } from "../../src/core/boards/board-panel.js"
import { BoardViews } from "../../src/core/boards/board-views.js"
import { EngineLane } from "../../src/core/refresh/engine-lane.js"
import { SharedDefinitions } from "../../src/core/refresh/shared-definitions.js"
import { badgeOf, boardFixture, stubbed, summary } from "./support/board-fixture.js"

const SOURCE = { fileName: "shop.board.json", asOf: new Date("2026-10-26T09:00:00Z"), problems: [] }

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
    expect(view.rows).toEqual([
      [{ kind: "processDiagram", title: "order", engine: "shop", bpmnProcessId: "order" }],
    ])
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
    expect(fixture.view().rows[0]?.[0]).toMatchObject({ diagram: { diagramXml: xml } })
  })
})
