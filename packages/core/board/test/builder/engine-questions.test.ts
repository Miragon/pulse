import { describe, expect, test } from "vitest"
import { BoardBuilder, type TileModel } from "../../src/builder/index.js"
import { BuilderWorld } from "./support/engines.js"

const ORDER = { process: "pulse-order" }
const LABEL = { process: "pulse-label" }

function numbersOf(tile: TileModel | undefined): unknown {
  switch (tile?.kind) {
    case "counter":
      return tile.total
    case "instanceList":
      return tile.groups.map((group) => group.instances?.length)
    case "processDiagram":
      return tile.badges?.map((badge) => badge.elementId)
    case "incidentList":
      return tile.groups.map((group) => group.incidents?.length)
    default:
      return tile?.kind
  }
}

describe("the questions a board asks an engine", () => {
  test("are each asked once, and each widget reads the answer to its own", async () => {
    const shop = BuilderWorld.counted("shop", BuilderWorld.world())
    const board = BuilderWorld.board(
      [
        { widget: "counter", props: { filter: ORDER } },
        { widget: "counter", props: { filter: LABEL } },
        { widget: "instanceList", props: { filter: ORDER } },
        { widget: "instanceList", props: { filter: LABEL } },
        { widget: "processDiagram", props: ORDER },
        { widget: "processDiagram", props: LABEL },
        { widget: "incidentList", props: ORDER },
        { widget: "incidentList", props: LABEL },
        { widget: "incidentList" },
      ],
      ["shop"],
    )

    const model = await BoardBuilder.build(board, [shop.source])

    expect(model.rows.map((row) => numbersOf(row[0]))).toStrictEqual([
      { count: 3 },
      { count: 1 },
      [3],
      [1],
      ["Activity_ReviewOrder"],
      ["Activity_RenderLabel"],
      [1],
      [1],
      [2],
    ])
    expect(shop.calls.toSorted()).toStrictEqual([
      "countInstances",
      "countInstances",
      "describeEngine",
      "getDiagramXml",
      "getDiagramXml",
      "getElementStatistics",
      "getElementStatistics",
      "listDefinitions",
      "searchIncidents",
      "searchIncidents",
      "searchIncidents",
      "searchInstances",
      "searchInstances",
    ])
  })

  test("ask for the incidents of a process by its id, and of every process without naming one", async () => {
    const world = BuilderWorld.world()
    const queries: unknown[] = []
    const reads = BuilderWorld.world({
      searchIncidents: (query, page) => {
        queries.push(query)
        return world.searchIncidents(query, page)
      },
    })
    const board = BuilderWorld.board(
      [{ widget: "incidentList", props: ORDER }, { widget: "incidentList" }],
      ["shop"],
    )

    await BoardBuilder.build(board, [{ name: "shop", reads }])

    expect(queries).toStrictEqual([{ bpmnProcessId: "pulse-order" }, {}])
  })
})
