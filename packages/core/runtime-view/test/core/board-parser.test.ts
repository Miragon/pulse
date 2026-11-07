import { describe, expect, test } from "vitest"
import { BoardParser, type BoardParse } from "../../src/core/boards/board-parser.js"

function problemsOf(parse: BoardParse) {
  if (!("problems" in parse)) {
    throw new Error("expected problems")
  }
  return parse.problems
}

function parseBoard(board: unknown): BoardParse {
  return BoardParser.parse(JSON.stringify(board))
}

const COUNTER = { widget: "counter", props: { filter: { process: "order" } } }

function withWidget(widget: unknown) {
  return { title: "Shop", engines: ["shop-dev", "shop-test"], rows: [{ row: [widget] }] }
}

describe("the board parser", () => {
  test("fills in the defaults: running instances, every engine, the default columns", () => {
    const parsed = parseBoard(
      withWidget({ widget: "instanceList", props: { filter: { process: "order" } } }),
    )

    expect(parsed).toEqual({
      board: {
        title: "Shop",
        engines: ["shop-dev", "shop-test"],
        rows: [
          [
            {
              widget: "instanceList",
              engines: ["shop-dev", "shop-test"],
              filter: { state: "running", process: "order" },
              columns: ["businessKey", "process", "state", "startedAt"],
            },
          ],
        ],
      },
    })
  })

  test("keeps every filter key, the title and the threshold of a counter", () => {
    const parsed = parseBoard(
      withWidget({
        widget: "counter",
        props: {
          title: "Waiting for payment",
          engines: ["shop-dev"],
          filter: {
            process: "order",
            activeElement: "Task_Pay",
            withIncident: false,
            businessKey: "B-1",
          },
          warnAbove: 10,
        },
      }),
    )

    expect("board" in parsed && parsed.board.rows[0]?.[0]).toEqual({
      widget: "counter",
      title: "Waiting for payment",
      engines: ["shop-dev"],
      filter: {
        state: "running",
        process: "order",
        activeElement: "Task_Pay",
        withIncident: false,
        businessKey: "B-1",
      },
      warnAbove: 10,
    })
  })

  test("groups incidents by process unless told otherwise", () => {
    const parsed = parseBoard(withWidget({ widget: "incidentSummary" }))

    expect("board" in parsed && parsed.board.rows[0]?.[0]).toEqual({
      widget: "incidentSummary",
      engines: ["shop-dev", "shop-test"],
      groupBy: "process",
    })
  })

  test("names a file that is not JSON", () => {
    expect(problemsOf(BoardParser.parse("{ title"))).toEqual([
      { path: "(file)", reason: "is not valid JSON" },
    ])
  })

  test("names every missing or misshapen key of the document", () => {
    expect(problemsOf(parseBoard([]))).toEqual([{ path: "(file)", reason: "must be an object" }])
    expect(problemsOf(parseBoard({ layout: 1 }))).toEqual([
      {
        path: "layout",
        reason: "is not a known key; use $schema, schemaVersion, title, engines, rows",
      },
      { path: "title", reason: "is missing" },
      { path: "engines", reason: "is missing" },
      { path: "rows", reason: "is missing" },
    ])
    expect(problemsOf(parseBoard({ title: " ", engines: [], rows: {} }))).toEqual([
      { path: "title", reason: "must be a text that is not empty" },
      { path: "engines", reason: "must be a list of different engine names that is not empty" },
    ])
    expect(problemsOf(parseBoard({ title: "Shop", engines: ["a"], rows: {} }))).toEqual([
      { path: "rows", reason: "must be a list" },
    ])
  })

  test("names the version it found when it cannot read it", () => {
    expect(problemsOf(parseBoard({ ...withWidget(COUNTER), schemaVersion: 2 }))).toEqual([
      { path: "schemaVersion", reason: "is 2; this version of Pulse reads version 1" },
    ])
  })

  test("names rows and widgets that are not shaped right", () => {
    const board = {
      title: "Shop",
      engines: ["shop-dev"],
      rows: [1, { cells: [] }, { row: "x" }, { row: [{ props: {} }, { widget: "chart" }, 3] }],
    }

    expect(problemsOf(parseBoard(board))).toEqual([
      { path: "rows[0]", reason: "must be an object" },
      { path: "rows[1].cells", reason: "is not a known key; use row" },
      { path: "rows[1].row", reason: "is missing" },
      { path: "rows[2].row", reason: "must be a list" },
      { path: "rows[3].row[0].widget", reason: "is missing" },
      {
        path: "rows[3].row[1].widget",
        reason:
          "must be one of counter, instanceList, incidentSummary, processDiagram, incidentList",
      },
      { path: "rows[3].row[2]", reason: "must be an object" },
    ])
  })

  test("names props that do not belong to the widget", () => {
    const widget = { widget: "incidentSummary", props: { groupBy: "type", filter: {} }, span: 2 }

    expect(problemsOf(parseBoard(withWidget(widget)))).toEqual([
      {
        path: "rows[0].row[0].span",
        reason: "is not a known key; use widget, props",
      },
      {
        path: "rows[0].row[0].props.filter",
        reason: "is not a known key; use title, engines, groupBy",
      },
      { path: "rows[0].row[0].props.groupBy", reason: "must be one of engine, process" },
    ])
    expect(problemsOf(parseBoard(withWidget({ widget: "counter", props: 1 })))).toEqual([
      { path: "rows[0].row[0].props", reason: "must be an object" },
    ])
  })

  test("rejects a filter that contradicts itself", () => {
    const widget = {
      widget: "counter",
      props: {
        filter: { activeElement: "Task_Pay", state: "ended", withIncident: "yes", owner: 1 },
      },
    }

    expect(problemsOf(parseBoard(withWidget(widget)))).toEqual([
      {
        path: "rows[0].row[0].props.filter.owner",
        reason: "is not a known key; use process, activeElement, state, withIncident, businessKey",
      },
      { path: "rows[0].row[0].props.filter.withIncident", reason: "must be true or false" },
      {
        path: "rows[0].row[0].props.filter.activeElement",
        reason: "needs a process: element ids are only unique within one process",
      },
      {
        path: "rows[0].row[0].props.filter.activeElement",
        reason: 'only matches running instances; remove it or use state "running"',
      },
    ])
    expect(
      problemsOf(parseBoard(withWidget({ widget: "counter", props: { filter: [] } }))),
    ).toEqual([{ path: "rows[0].row[0].props.filter", reason: "must be an object" }])
  })

  test("only lets a widget narrow the engines of the board", () => {
    const widget = { widget: "counter", props: { engines: ["shop-dev", "prod-eu"] } }

    expect(problemsOf(parseBoard(withWidget(widget)))).toEqual([
      {
        path: "rows[0].row[0].props.engines",
        reason: "may only name engines of the board; prod-eu is not in its engines",
      },
    ])
  })

  test("rejects a threshold that is not a whole number of 0 or more", () => {
    for (const warnAbove of [-1, 1.5, "10"]) {
      const widget = { widget: "counter", props: { warnAbove } }

      expect(problemsOf(parseBoard(withWidget(widget)))).toEqual([
        { path: "rows[0].row[0].props.warnAbove", reason: "must be a whole number of 0 or more" },
      ])
    }
  })

  test("refuses variable columns and unknown columns with a reason each", () => {
    const widget = { widget: "instanceList", props: { columns: ["engine", "var:amount", "owner"] } }

    expect(problemsOf(parseBoard(withWidget(widget)))).toEqual([
      { path: "rows[0].row[0].props.columns[1]", reason: "variable columns are not supported yet" },
      {
        path: "rows[0].row[0].props.columns[2]",
        reason:
          "must be one of engine, process, version, businessKey, state, startedAt, endedAt, incident",
      },
    ])
    expect(
      problemsOf(parseBoard(withWidget({ widget: "instanceList", props: { columns: "engine" } }))),
    ).toEqual([{ path: "rows[0].row[0].props.columns", reason: "must be a list" }])
  })

  test("keeps a board at 12 widgets so it stays cheap for the engines", () => {
    const row = { row: Array.from({ length: 7 }, () => COUNTER) }
    const board = { title: "Shop", engines: ["shop-dev"], rows: [row, row] }

    expect(problemsOf(parseBoard(board))).toEqual([
      {
        path: "rows",
        reason: "hold 14 widgets; a board shows at most 12, so it stays cheap for the engines",
      },
    ])
  })

  test("refuses an engine named twice and a list without columns", () => {
    const board = {
      title: "Shop",
      engines: ["shop-dev", "shop-dev"],
      rows: [{ row: [{ widget: "instanceList", props: { columns: [] } }] }],
    }

    expect(problemsOf(parseBoard(board))).toEqual([
      { path: "engines", reason: "must be a list of different engine names that is not empty" },
    ])
    expect(
      problemsOf(parseBoard(withWidget({ widget: "instanceList", props: { columns: [] } }))),
    ).toEqual([{ path: "rows[0].row[0].props.columns", reason: "must name at least one column" }])
  })

  test("accepts exactly 12 widgets", () => {
    const row = { row: Array.from({ length: 6 }, () => COUNTER) }

    expect(parseBoard({ title: "Shop", engines: ["shop-dev"], rows: [row, row] })).toHaveProperty(
      "board",
    )
  })
})
