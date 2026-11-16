import { describe, expect, test } from "vitest"
import { BoardParser, BoardProblems, type BoardParse, type BoardProblem } from "../../src/index.js"

function worded(problems: readonly BoardProblem[]) {
  return problems.map((problem) => ({
    path: problem.path,
    reason: BoardProblems.describe(problem),
  }))
}

function problemsOf(parse: BoardParse) {
  if (!("problems" in parse)) {
    throw new Error("expected problems")
  }
  return worded(parse.problems)
}

function refusalsOf(parse: BoardParse, column = 0, row = 0) {
  const tile = "board" in parse ? parse.board.rows[row]?.[column] : undefined
  if (tile === undefined || !("refused" in tile)) {
    throw new Error("expected a refused widget")
  }
  return worded(tile.refused)
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

    expect(parsed).toStrictEqual({
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
      notes: [],
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

    expect("board" in parsed && parsed.board.rows[0]?.[0]).toStrictEqual({
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

    expect("board" in parsed && parsed.board.rows[0]?.[0]).toStrictEqual({
      widget: "incidentSummary",
      engines: ["shop-dev", "shop-test"],
      groupBy: "process",
    })
  })

  test("reads a filter without a process as one over every process", () => {
    const parsed = parseBoard(
      withWidget({ widget: "counter", props: { filter: { state: "ended" } } }),
    )

    expect("board" in parsed && parsed.board.rows[0]?.[0]).toStrictEqual({
      widget: "counter",
      engines: ["shop-dev", "shop-test"],
      filter: { state: "ended" },
    })
  })

  test("names a file that is not JSON", () => {
    expect(problemsOf(BoardParser.parse("{ title"))).toStrictEqual([
      { path: "(file)", reason: "is not valid JSON" },
    ])
  })

  test("names every missing or misshapen key of the document", () => {
    expect(problemsOf(parseBoard([]))).toStrictEqual([
      { path: "(file)", reason: "must be an object" },
    ])
    expect(problemsOf(parseBoard({ layout: 1 }))).toStrictEqual([
      { path: "title", reason: "is missing" },
      { path: "engines", reason: "is missing" },
      { path: "rows", reason: "is missing" },
    ])
    expect(problemsOf(parseBoard({ title: " ", engines: [], rows: {} }))).toStrictEqual([
      { path: "title", reason: "must be a text that is not empty" },
      { path: "engines", reason: "must be a list of different engine names that is not empty" },
    ])
    expect(problemsOf(parseBoard({ title: "Shop", engines: ["a"], rows: {} }))).toStrictEqual([
      { path: "rows", reason: "must be a list" },
    ])
    expect(problemsOf(parseBoard({ title: "Shop", engines: ["a"] }))).toStrictEqual([
      { path: "rows", reason: "is missing" },
    ])
  })

  test("names the version it found when it cannot read it", () => {
    expect(problemsOf(parseBoard({ ...withWidget(COUNTER), schemaVersion: 2 }))).toStrictEqual([
      { path: "schemaVersion", reason: "is 2; this version of Pulse reads version 1" },
    ])
  })

  test("gives no board for rows that are not shaped right, naming each", () => {
    const board = {
      title: "Shop",
      engines: ["shop-dev"],
      rows: [1, { cells: [] }, { row: "x" }, { row: [{ widget: "chart" }] }],
    }

    expect(problemsOf(parseBoard(board))).toStrictEqual([
      { path: "rows[0]", reason: "must be an object" },
      { path: "rows[1].cells", reason: "is not a known key; use row" },
      { path: "rows[1].row", reason: "is missing" },
      { path: "rows[2].row", reason: "must be a list" },
    ])
  })

  test("refuses a widget that is not shaped right in its place and reads the ones beside it", () => {
    const parsed = parseBoard({
      title: "Shop",
      engines: ["shop-dev"],
      rows: [
        {
          row: [
            { props: { title: "No type" } },
            { widget: "chart", props: { title: " " } },
            3,
            { widget: "counter", props: { title: "Running" } },
          ],
        },
      ],
    })

    expect(refusalsOf(parsed)).toStrictEqual([
      { path: "rows[0].row[0].widget", reason: "is missing" },
    ])
    expect(refusalsOf(parsed, 1)).toStrictEqual([
      {
        path: "rows[0].row[1].widget",
        reason:
          "must be one of counter, instanceList, incidentSummary, processDiagram, incidentList",
      },
    ])
    expect(refusalsOf(parsed, 2)).toStrictEqual([
      { path: "rows[0].row[2]", reason: "must be an object" },
    ])
    expect("board" in parsed && parsed.board.rows[0]).toStrictEqual([
      { title: "No type", refused: [{ path: "rows[0].row[0].widget", code: "missing" }] },
      {
        widget: "chart",
        refused: [
          { path: "rows[0].row[1].widget", code: "notOneOf", values: expect.anything() as unknown },
        ],
      },
      { refused: [{ path: "rows[0].row[2]", code: "notAnObject" }] },
      {
        widget: "counter",
        title: "Running",
        engines: ["shop-dev"],
        filter: { state: "running" },
      },
    ])
  })

  test("notes a root key it does not know and shows the board without it", () => {
    expect(parseBoard({ title: "Shop", engines: ["a"], layout: "wide", rows: [] })).toStrictEqual({
      board: { title: "Shop", engines: ["a"], rows: [] },
      notes: [{ path: "layout", code: "ignoredKey" }],
    })
    expect(
      worded([{ path: "layout", code: "ignoredKey" }]).map((note) => note.reason),
    ).toStrictEqual(["is not a key this version of Pulse knows; Pulse shows the board without it"])
  })

  test("keeps the tenants a board names and gives no board for tenants of the wrong shape", () => {
    expect(
      parseBoard({ title: "Shop", engines: ["a"], tenants: ["acme"], rows: [] }),
    ).toStrictEqual({
      board: { title: "Shop", engines: ["a"], tenants: ["acme"], rows: [] },
      notes: [],
    })
    for (const tenants of ["acme", [], ["acme", "acme"], [" "]]) {
      expect(
        problemsOf(parseBoard({ title: "Shop", engines: ["a"], tenants, rows: [] })),
      ).toStrictEqual([
        { path: "tenants", reason: "must be a list of different tenant ids that is not empty" },
      ])
    }
  })

  test("refuses a widget of ended instances with incident, which could only show 0", () => {
    for (const widget of ["counter", "instanceList"]) {
      const filter = { process: "order", state: "ended", withIncident: true }

      expect(refusalsOf(parseBoard(withWidget({ widget, props: { filter } })))).toStrictEqual([
        {
          path: "rows[0].row[0].props.filter.withIncident",
          reason:
            'only matches running instances, since an ended instance has no open incident; remove it or use state "running"',
        },
      ])
    }
    const without = { state: "ended", withIncident: false }

    expect(
      parseBoard(withWidget({ widget: "counter", props: { filter: without } })),
    ).toHaveProperty("board.rows.0.0.filter", without)
  })

  test("names props that do not belong to the widget", () => {
    const widget = { widget: "incidentSummary", props: { groupBy: "type", filter: {} }, span: 2 }

    expect(refusalsOf(parseBoard(withWidget(widget)))).toStrictEqual([
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
    expect(refusalsOf(parseBoard(withWidget({ widget: "counter", props: 1 })))).toStrictEqual([
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

    expect(refusalsOf(parseBoard(withWidget(widget)))).toStrictEqual([
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
      refusalsOf(parseBoard(withWidget({ widget: "counter", props: { filter: [] } }))),
    ).toStrictEqual([{ path: "rows[0].row[0].props.filter", reason: "must be an object" }])
  })

  test("only lets a widget narrow the engines of the board", () => {
    const widget = { widget: "counter", props: { engines: ["shop-dev", "prod-eu"] } }

    expect(refusalsOf(parseBoard(withWidget(widget)))).toStrictEqual([
      {
        path: "rows[0].row[0].props.engines",
        reason: "may only name engines of the board; prod-eu is not in its engines",
      },
    ])
  })

  test("rejects a threshold that is not a whole number of 0 or more", () => {
    for (const warnAbove of [-1, 1.5, "10"]) {
      const widget = { widget: "counter", props: { warnAbove } }

      expect(refusalsOf(parseBoard(withWidget(widget)))).toStrictEqual([
        { path: "rows[0].row[0].props.warnAbove", reason: "must be a whole number of 0 or more" },
      ])
    }
  })

  test("refuses a variable column and an unknown column, naming the columns a board shows", () => {
    const widget = { widget: "instanceList", props: { columns: ["engine", "var:amount", "owner"] } }
    const known =
      "must be one of engine, process, version, businessKey, state, startedAt, endedAt, incident"

    expect(refusalsOf(parseBoard(withWidget(widget)))).toStrictEqual([
      { path: "rows[0].row[0].props.columns[1]", reason: `cannot show a variable; ${known}` },
      { path: "rows[0].row[0].props.columns[2]", reason: known },
    ])
    expect(
      refusalsOf(parseBoard(withWidget({ widget: "instanceList", props: { columns: "engine" } }))),
    ).toStrictEqual([{ path: "rows[0].row[0].props.columns", reason: "must be a list" }])
  })

  test("keeps a board at 12 widgets so it stays cheap for the engines", () => {
    const titled = { widget: "counter", props: { title: "Last" } }
    const row = { row: [...Array.from({ length: 6 }, () => COUNTER), { widget: "chart" }] }
    const board = {
      title: "Shop",
      engines: ["shop-dev"],
      rows: [row, { ...row, row: [...row.row, titled] }],
    }
    const parsed = parseBoard(board)
    const rows = "board" in parsed ? parsed.board.rows : []

    expect(rows.flat().filter((tile) => !("refused" in tile))).toHaveLength(12)
    expect(rows[1]?.[7]).toStrictEqual({
      widget: "counter",
      title: "Last",
      refused: [
        { path: "rows[1].row[7]", code: "tooManyWidgets", values: { position: 13, max: 12 } },
      ],
    })
    expect(refusalsOf(parsed, 7, 1)).toStrictEqual([
      {
        path: "rows[1].row[7]",
        reason: "is widget 13; a board shows at most 12, so it stays cheap for the engines",
      },
    ])
  })

  test("refuses an engine named twice and a list without columns", () => {
    const board = {
      title: "Shop",
      engines: ["shop-dev", "shop-dev"],
      rows: [{ row: [{ widget: "instanceList", props: { columns: [] } }] }],
    }

    expect(problemsOf(parseBoard(board))).toStrictEqual([
      { path: "engines", reason: "must be a list of different engine names that is not empty" },
    ])
    expect(
      refusalsOf(parseBoard(withWidget({ widget: "instanceList", props: { columns: [] } }))),
    ).toStrictEqual([
      { path: "rows[0].row[0].props.columns", reason: "must name at least one column" },
    ])
  })

  test("accepts exactly 12 widgets", () => {
    const row = { row: Array.from({ length: 6 }, () => COUNTER) }

    expect(parseBoard({ title: "Shop", engines: ["shop-dev"], rows: [row, row] })).toHaveProperty(
      "board",
    )
  })
})
