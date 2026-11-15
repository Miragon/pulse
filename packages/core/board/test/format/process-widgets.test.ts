import { describe, expect, test } from "vitest"
import { BoardParser, BoardProblems, type BoardParse } from "../../src/index.js"

function board(widgets: unknown[], engines: string[]) {
  return { title: "Orders", engines, rows: widgets.map((widget) => ({ row: [widget] })) }
}

function parse(widget: unknown, engines = ["shop", "billing"]): BoardParse {
  return BoardParser.parse(JSON.stringify(board([widget], engines)))
}

function refusalsOf(widget: unknown, engines?: string[]) {
  const parsed = parse(widget, engines)
  const tile = "board" in parsed ? parsed.board.rows[0]?.[0] : undefined
  if (tile === undefined || !("refused" in tile)) {
    throw new Error("expected a refused widget")
  }
  return tile.refused.map((problem) => ({
    path: problem.path,
    reason: BoardProblems.describe(problem),
  }))
}

describe("the process widgets of a board file", () => {
  test("read a diagram of one engine and incidents of a process or of every process", () => {
    const parsed = BoardParser.parse(
      JSON.stringify({
        title: "Orders",
        engines: ["shop"],
        rows: [
          {
            row: [
              { widget: "processDiagram", props: { title: "Orders", process: "order" } },
              { widget: "incidentList", props: { process: "order" } },
              { widget: "incidentList" },
            ],
          },
        ],
      }),
    )

    expect(parsed).toEqual({
      board: {
        title: "Orders",
        engines: ["shop"],
        rows: [
          [
            { widget: "processDiagram", engines: ["shop"], title: "Orders", process: "order" },
            { widget: "incidentList", engines: ["shop"], process: "order" },
            { widget: "incidentList", engines: ["shop"] },
          ],
        ],
      },
      notes: [],
    })
  })

  test("refuse a diagram without a process or over several engines", () => {
    expect(refusalsOf({ widget: "processDiagram" })).toEqual([
      { path: "rows[0].row[0].props.process", reason: "is missing" },
      {
        path: "rows[0].row[0].props.engines",
        reason: "must name one engine, because a diagram shows the deployment of one engine",
      },
    ])
    expect(refusalsOf({ widget: "processDiagram", props: { process: " " } }, ["shop"])).toEqual([
      { path: "rows[0].row[0].props.process", reason: "must be a text that is not empty" },
    ])
    expect(refusalsOf({ widget: "incidentList", props: { filter: {} } })).toEqual([
      {
        path: "rows[0].row[0].props.filter",
        reason: "is not a known key; use title, engines, process",
      },
    ])
  })
})
