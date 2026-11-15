import { describe, expect, it } from "vitest"
import { BoardParser } from "../format/board-parser.js"
import entries from "./board-fixtures.json" with { type: "json" }
import { BOARD_FIXTURES } from "./index.js"

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

  it("state each case as a text or a file, never both, with one verdict", () => {
    for (const entry of entries as readonly Readonly<Record<string, unknown>>[]) {
      const name = String(entry.name)
      expect(
        Object.keys(entry).filter((key) => !FIXTURE_KEYS.includes(key)),
        name,
      ).toEqual([])
      expect("text" in entry !== "file" in entry, name).toBe(true)
      expect(typeof entry.schema, name).toBe("boolean")
      expect(Object.keys(entry.verdict as object), name).toHaveLength(1)
    }
  })

  it("write a file as a reader finds it on disk: two spaces and a last line break", () => {
    const starter = BOARD_FIXTURES.find((fixture) => fixture.name === "starter-board")

    expect(starter?.text).toMatch(/^\{\n {2}"schemaVersion": 1,\n[^]*\n\}\n$/)
    expect(BOARD_FIXTURES.find((fixture) => fixture.name === "not-json")?.text).toBe(
      '{ "title": "Shop"\n',
    )
  })

  it("cover boards and refusals, of the file, the document, a row, a widget and a filter", () => {
    const problems = BOARD_FIXTURES.flatMap((fixture) =>
      "problems" in fixture.verdict ? fixture.verdict.problems : [],
    )
    const paths = problems.map((problem) => problem.path)

    expect(BOARD_FIXTURES.filter((fixture) => "board" in fixture.verdict).length).toBeGreaterThan(4)
    expect(paths).toEqual(
      expect.arrayContaining([
        "(file)",
        "schemaVersion",
        "rows[0]",
        "rows[0].row[0].props",
        "rows[0].row[0].props.filter.activeElement",
      ]),
    )
  })

  it.each(BOARD_FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    "%s: the parser gives the verdict the fixture states",
    (_name, fixture) => {
      expect(BoardParser.parse(fixture.text)).toEqual(fixture.verdict)
    },
  )
})
