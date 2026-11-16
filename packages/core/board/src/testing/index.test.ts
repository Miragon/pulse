import { describe, expect, it } from "vitest"
import { BoardParser } from "../format/board-parser.js"
import type { BoardProblem } from "../format/board-problems.js"
import entries from "./board-fixtures.json" with { type: "json" }
import { BOARD_FIXTURES, type BoardFixture } from "./index.js"

class FixtureVerdicts {
  static problemsOf({ verdict }: BoardFixture): readonly BoardProblem[] {
    if ("problems" in verdict) {
      return verdict.problems
    }
    return verdict.board.rows.flat().flatMap((tile) => ("refused" in tile ? tile.refused : []))
  }

  static notesOf({ verdict }: BoardFixture): readonly BoardProblem[] {
    return "notes" in verdict ? verdict.notes : []
  }

  static keysOf(verdict: unknown): string {
    return Object.keys(verdict as object)
      .sort()
      .join()
  }
}

const FIXTURE_KEYS = ["name", "about", "text", "file", "schema", "verdict"]

describe("the shared board fixtures", () => {
  it("are many, each named once, each with a sentence on what it pins", () => {
    expect(BOARD_FIXTURES.length).toBeGreaterThan(20)
    const names = BOARD_FIXTURES.map((fixture) => fixture.name)
    expect(new Set(names).size).toBe(names.length)
    for (const fixture of BOARD_FIXTURES) {
      expect(fixture.about, fixture.name).toMatch(/^\S.+\.$/)
    }
  })

  it("state each case as a text or a file, never both, with one verdict: problems, or a board with its notes", () => {
    for (const entry of entries as readonly Readonly<Record<string, unknown>>[]) {
      const name = String(entry.name)
      expect(
        Object.keys(entry).filter((key) => !FIXTURE_KEYS.includes(key)),
        name,
      ).toStrictEqual([])
      expect("text" in entry !== "file" in entry, name).toBe(true)
      expect(typeof entry.schema, name).toBe("boolean")
      expect(["problems", "board,notes"], name).toContain(FixtureVerdicts.keysOf(entry.verdict))
    }
  })

  it("write a file as a reader finds it on disk: two spaces and a last line break", () => {
    const starter = BOARD_FIXTURES.find((fixture) => fixture.name === "starter-board")

    expect(starter?.text).toMatch(/^\{\n {2}"schemaVersion": 1,\n[^]*\n\}\n$/)
    expect(BOARD_FIXTURES.find((fixture) => fixture.name === "not-json")?.text).toBe(
      '{ "title": "Shop"\n',
    )
  })

  it("cover boards, notes and refusals, of the file, the document, a row, a widget and a filter", () => {
    const paths = BOARD_FIXTURES.flatMap((fixture) => FixtureVerdicts.problemsOf(fixture)).map(
      (problem) => problem.path,
    )
    const notes = BOARD_FIXTURES.flatMap((fixture) => FixtureVerdicts.notesOf(fixture))

    expect(BOARD_FIXTURES.filter((fixture) => "board" in fixture.verdict).length).toBeGreaterThan(4)
    expect(notes.map((note) => note.code)).toStrictEqual(["ignoredKey"])
    expect(paths).toStrictEqual(
      expect.arrayContaining([
        "(file)",
        "schemaVersion",
        "rows[0]",
        "rows[0].row[0].props",
        "rows[0].row[0].props.filter.activeElement",
        "rows[0].row[0].props.filter.withIncident",
        "rows[1].row[5]",
        "tenants",
      ]),
    )
  })

  it.each(BOARD_FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    "%s: the parser gives the verdict the fixture states",
    (_name, fixture) => {
      expect(BoardParser.parse(fixture.text)).toStrictEqual(fixture.verdict)
    },
  )
})
