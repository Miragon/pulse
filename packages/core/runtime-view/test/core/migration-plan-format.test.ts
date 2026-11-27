import { MigrationPlanProblems } from "@miragon/pulse-migration-plan"
import { MIGRATION_PLAN_FIXTURES } from "@miragon/pulse-migration-plan/testing"
import { describe, expect, test } from "vitest"
import { openPlan } from "./support/plan-fixture.js"

const REFUSED = MIGRATION_PLAN_FIXTURES.filter((fixture) => "problems" in fixture.verdict)
const ACCEPTED = MIGRATION_PLAN_FIXTURES.filter((fixture) => "plan" in fixture.verdict)

describe("the shared migration plan fixtures in the preview", () => {
  test("hold refused and accepted files", () => {
    expect(REFUSED.length).toBeGreaterThan(0)
    expect(ACCEPTED.length).toBeGreaterThan(0)
  })

  test.each(REFUSED.map((fixture) => [fixture.name, fixture] as const))(
    "%s is refused with its first problem and reads nothing on the engine",
    async (_, fixture) => {
      const opened = await openPlan(fixture.text)
      const state = opened.fixture.lastState()
      const [first] = "problems" in fixture.verdict ? fixture.verdict.problems : []

      expect(state.status).toBe("failed")
      const detail = state.status === "failed" ? state.problem.detail : ""
      const where = first?.path === "(file)" ? "The file" : first?.path
      expect(detail.startsWith(`${where} ${MigrationPlanProblems.describe(first!)}.`)).toBe(true)
      expect(opened.fixture.calls).toEqual([])
    },
  )

  test.each(ACCEPTED.map((fixture) => [fixture.name, fixture] as const))(
    "%s is read and looked up on the engine",
    async (_, fixture) => {
      const opened = await openPlan(fixture.text)

      expect(opened.fixture.calls.slice(0, 2)).toEqual(["listDefinitions", "listVersions"])
    },
  )
})
