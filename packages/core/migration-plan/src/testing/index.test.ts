import { describe, expect, it } from "vitest"
import type { MigrationPlanNote, MigrationPlanProblem } from "../format/plan-definition.js"
import { MigrationPlanParser } from "../format/plan-parser.js"
import { MigrationPlanText } from "../format/plan-text.js"
import * as testing from "./index.js"
import entries from "./migration-plan-fixtures.json" with { type: "json" }
import { MIGRATION_PLAN_FIXTURES, type MigrationPlanFixture } from "./index.js"

class FixtureVerdicts {
  static problemsOf({ verdict }: MigrationPlanFixture): readonly MigrationPlanProblem[] {
    return "problems" in verdict ? verdict.problems : []
  }

  static notesOf({ verdict }: MigrationPlanFixture): readonly MigrationPlanNote[] {
    return "notes" in verdict ? verdict.notes : []
  }

  static keysOf(verdict: unknown): string {
    return Object.keys(verdict as object)
      .sort()
      .join()
  }

  static named(name: string): MigrationPlanFixture {
    const fixture = MIGRATION_PLAN_FIXTURES.find((candidate) => candidate.name === name)
    if (fixture === undefined) {
      throw new Error(`no fixture ${name}`)
    }
    return fixture
  }
}

const FIXTURE_KEYS = ["name", "about", "text", "file", "schema", "verdict"]

describe("the @miragon/pulse-migration-plan/testing entry", () => {
  it("exports exactly the shared fixtures", () => {
    expect(Object.keys(testing).sort()).toStrictEqual(["MIGRATION_PLAN_FIXTURES"])
  })
})

describe("the shared migration plan fixtures", () => {
  it("are named once each, each with a sentence on what it pins", () => {
    const names = MIGRATION_PLAN_FIXTURES.map((fixture) => fixture.name)
    expect(names.length).toBeGreaterThan(15)
    expect(new Set(names).size).toBe(names.length)
    for (const fixture of MIGRATION_PLAN_FIXTURES) {
      expect(fixture.about, fixture.name).toMatch(/^\S.+\.$/)
    }
  })

  it("state each case as a text or a file, never both, with one verdict: problems, or a plan with its notes", () => {
    for (const entry of entries as readonly Readonly<Record<string, unknown>>[]) {
      const name = String(entry.name)
      expect(
        Object.keys(entry).filter((key) => !FIXTURE_KEYS.includes(key)),
        name,
      ).toStrictEqual([])
      expect("text" in entry !== "file" in entry, name).toBe(true)
      expect(typeof entry.schema, name).toBe("boolean")
      expect(["notes,plan", "problems"], name).toContain(FixtureVerdicts.keysOf(entry.verdict))
    }
  })

  it("write a file as a reader finds it on disk: two spaces and a last line break", () => {
    expect(FixtureVerdicts.named("minimal").text).toMatch(
      /^\{\n {2}"schemaVersion": 1,\n[^]*\n\}\n$/,
    )
    expect(FixtureVerdicts.named("not-json").text).toBe('{ "bpmnProcessId": "invoice"\n')
  })

  it("hold the text of the writer for the full plan", () => {
    const full = FixtureVerdicts.named("full")
    if (!("plan" in full.verdict)) {
      throw new Error("the full fixture gives a plan")
    }
    expect(MigrationPlanText.of(full.verdict.plan)).toBe(full.text)
  })

  it("cover plans, notes and refusals of the file, the root, a side and a mapping", () => {
    const problems = MIGRATION_PLAN_FIXTURES.flatMap((fixture) =>
      FixtureVerdicts.problemsOf(fixture),
    )
    const notes = MIGRATION_PLAN_FIXTURES.flatMap((fixture) => FixtureVerdicts.notesOf(fixture))
    expect(MIGRATION_PLAN_FIXTURES.filter((fixture) => "plan" in fixture.verdict).length).toBe(5)
    expect(notes.map((note) => note.code)).toStrictEqual(["ignoredKey", "schemaNotText"])
    expect(problems.map((problem) => problem.path)).toStrictEqual(
      expect.arrayContaining([
        "(file)",
        "schemaVersion",
        "bpmnProcessId",
        "source.version",
        "target.version",
        "source.tenantId",
        "mappings[0].sourceElementId",
      ]),
    )
  })

  it.each(MIGRATION_PLAN_FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    "%s: the parser gives the verdict the fixture states",
    (_name, fixture) => {
      expect(MigrationPlanParser.parse(fixture.text)).toStrictEqual(fixture.verdict)
    },
  )
})
