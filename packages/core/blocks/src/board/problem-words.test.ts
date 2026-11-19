import { BoardProblems, BoardTiles, type BoardProblem } from "@miragon/pulse-board"
import { BOARD_FIXTURES } from "@miragon/pulse-board/testing"
import { describe, expect, it } from "vitest"
import { en } from "../messages/en.js"
import { translate, type Words } from "../messages/translate.js"
import { problemText } from "./problem-words.js"

const english: Words = (key, params) => translate("en", key, params)
const german: Words = (key, params) => translate("de", key, params)

/** The problems the shared fixtures give: a file's, a refused widget's and a note. */
function fixtureProblems(): readonly BoardProblem[] {
  return BOARD_FIXTURES.flatMap(({ verdict }) =>
    "problems" in verdict
      ? verdict.problems
      : [
          ...verdict.notes,
          ...BoardTiles.of(verdict.board)
            .flat()
            .flatMap((tile) => ("refused" in tile ? tile.refused : [])),
        ],
  )
}

/**
 * The cases no fixture gives: a board with tenants, several engines outside the board, and the
 * builder's note on a diagram longer than it reads.
 */
const MORE: readonly BoardProblem[] = [
  { path: "tenants", code: "tenantsNotRead" },
  {
    path: "rows[0].row[0].props.engines",
    code: "engineOutsideBoard",
    values: { engines: ["prod-eu", "prod-us"] },
  },
  {
    path: "rows[0].row[1]",
    code: "diagramTooLong",
    values: { title: "Orders", engine: "prod-eu" },
  },
]

const PROBLEMS = [...fixtureProblems(), ...MORE]

describe("the words of a board file's problems", () => {
  it("are in English the format's own words, the sentence after the path", () => {
    for (const problem of PROBLEMS) {
      expect(problemText(english, problem)).toBe(BoardProblems.describe(problem))
    }
  })

  it("cover every code of the format, schemaNotText and engineOutsideBoard among them", () => {
    const codes = new Set(PROBLEMS.map((problem) => problem.code))
    const worded = Object.keys(en)
      .filter((key) => key.startsWith("problem."))
      .map((key) => key.slice("problem.".length))

    expect([...codes].sort()).toEqual(worded.sort())
  })

  it("are German in a German locale, with the values in their place", () => {
    for (const problem of PROBLEMS) {
      expect(problemText(german, problem)).not.toBe(problemText(english, problem))
    }
    expect(problemText(german, MORE[1]!)).toBe(
      "darf nur Engines des Boards nennen; prod-eu, prod-us sind nicht unter seinen Engines",
    )
    expect(
      problemText(german, {
        path: "schemaVersion",
        code: "unknownVersion",
        values: { found: "2", reads: 1 },
      }),
    ).toBe("ist 2; diese Version von Pulse liest Version 1")
  })
})
