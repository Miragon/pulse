import { describe, expect, test } from "vitest"
import {
  BoardParser,
  BoardVocabulary,
  type BoardParse,
  type BoardProblem,
  type BoardTile,
} from "../../src/index.js"

const SHOP = { title: "Shop", engines: ["shop"] }

function parseBoard(board: unknown): BoardParse {
  return BoardParser.parse(JSON.stringify(board))
}

function problemsOf(parse: BoardParse): readonly BoardProblem[] {
  if (!("problems" in parse)) {
    throw new Error("expected problems")
  }
  return parse.problems
}

function rowOf(row: readonly unknown[]): readonly BoardTile[] {
  const parsed = parseBoard({ ...SHOP, rows: [{ row }] })
  if (!("board" in parsed)) {
    throw new Error("expected a board")
  }
  return parsed.board.rows[0] ?? []
}

describe("a board file with a value of another type than the key takes", () => {
  test("names a document that is null as no object", () => {
    expect(BoardParser.parse("null")).toStrictEqual({
      problems: [{ path: "(file)", code: "notAnObject" }],
    })
  })

  test("names a title that is no text and engine names that are no text or blank", () => {
    expect(problemsOf(parseBoard({ ...SHOP, title: 5, rows: [] }))).toStrictEqual([
      { path: "title", code: "blankText" },
    ])
    for (const engines of [
      ["shop", " "],
      ["shop", 1],
    ]) {
      expect(problemsOf(parseBoard({ ...SHOP, engines, rows: [] }))).toStrictEqual([
        { path: "engines", code: "engineNames" },
      ])
    }
  })

  test("refuses a widget that is null or names its type with no text, and keeps neither as its type or title", () => {
    expect(rowOf([null, { widget: 5, props: { title: 7 } }])).toStrictEqual([
      { refused: [{ path: "rows[0].row[0]", code: "notAnObject" }] },
      {
        refused: [
          {
            path: "rows[0].row[1].widget",
            code: "notOneOf",
            values: { choices: BoardVocabulary.WIDGETS },
          },
        ],
      },
    ])
  })

  test("takes a threshold of 0 and refuses a column that is no text", () => {
    const counter = { widget: "counter", props: { warnAbove: 0 } }
    const list = { widget: "instanceList", props: { columns: [5] } }

    expect(rowOf([counter, list])).toStrictEqual([
      { widget: "counter", engines: ["shop"], filter: { state: "running" }, warnAbove: 0 },
      {
        widget: "instanceList",
        refused: [
          {
            path: "rows[0].row[1].props.columns[0]",
            code: "notOneOf",
            values: { choices: BoardVocabulary.COLUMNS },
          },
        ],
      },
    ])
  })
})

describe("a board file the parser stops reading at its first problem", () => {
  test("names a title it cannot read and not the rows behind it", () => {
    expect(problemsOf(parseBoard({ ...SHOP, title: " ", rows: {} }))).toStrictEqual([
      { path: "title", code: "blankText" },
    ])
  })

  test("refuses a widget at a filter it cannot read and reads no prop behind it", () => {
    const counter = { widget: "counter", props: { filter: { state: "paused" }, warnAbove: -1 } }

    expect(rowOf([counter])).toStrictEqual([
      {
        widget: "counter",
        refused: [
          {
            path: "rows[0].row[0].props.filter.state",
            code: "notOneOf",
            values: { choices: BoardVocabulary.STATES },
          },
        ],
      },
    ])
  })

  test("refuses a widget after the 12th without a title of its own and gives it none", () => {
    const row = Array.from({ length: 13 }, () => ({ widget: "incidentList" }))

    expect(rowOf(row)[12]).toStrictEqual({
      widget: "incidentList",
      refused: [
        { path: "rows[0].row[12]", code: "tooManyWidgets", values: { position: 13, max: 12 } },
      ],
    })
  })
})
