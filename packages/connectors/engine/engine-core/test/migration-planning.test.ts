import { describe, expect, test } from "vitest"
import { CASE, PatchedRuntime, WORLD_ELEMENT, type CaseName } from "../src/testing/index.js"
import { SabotagedRuntime, type Sabotage } from "./support/sabotaged-runtime.js"

const MIGRATION_SABOTAGES: readonly (readonly [string, Sabotage, readonly CaseName[]])[] = [
  [
    "the migration check finds nothing",
    () => ({ checkMigration: () => Promise.resolve({ problems: [] }) }),
    [CASE.migrationCheck],
  ],
  [
    "a migration problem does not name its mapping",
    (runtime) => ({
      checkMigration: async (plan) => {
        const check = await runtime.checkMigration!(plan)
        return { problems: check.problems.map(({ message }) => ({ message })) }
      },
    }),
    [CASE.migrationCheck],
  ],
  [
    "the migration proposal maps only user tasks",
    (runtime) => ({
      proposeMigration: async (source, target) => {
        const plan = await runtime.proposeMigration!(source, target)
        return {
          ...plan,
          mappings: plan.mappings.filter(
            (mapping) => mapping.sourceElementId !== WORLD_ELEMENT.chargePayment,
          ),
        }
      },
    }),
    [CASE.migrationProposal],
  ],
]

describe("the kit", () => {
  test("accepts a runtime that plans no migrations", async () => {
    const planless = SabotagedRuntime.without(["proposeMigration", "checkMigration"])

    expect(await SabotagedRuntime.failingCases(planless)).toEqual([])
  })

  test("keeps a patched runtime over one that plans no migrations without planning", async () => {
    const planless = SabotagedRuntime.without(["proposeMigration", "checkMigration"])
    const patched = new PatchedRuntime(planless.runtime, {})

    expect(patched.proposeMigration).toBeUndefined()
    expect(patched.checkMigration).toBeUndefined()
    expect(await SabotagedRuntime.failingCases({ ...planless, runtime: patched })).toEqual([])
  })

  test("refuses a runtime that only does half of migration planning", async () => {
    const half = SabotagedRuntime.without(["checkMigration"])

    expect(await SabotagedRuntime.failingCases(half)).toEqual(
      [CASE.migrationCheck, CASE.migrationProposal].sort(),
    )
  })

  test.each(MIGRATION_SABOTAGES)(
    "catches a runtime where %s",
    async (_flaw, sabotage, expected) => {
      expect(await SabotagedRuntime.failingCases(SabotagedRuntime.with(sabotage))).toEqual(
        [...expected].sort(),
      )
    },
  )
})
