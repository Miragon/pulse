import { ElementId } from "../../../model/ids.js"
import type { ElementMapping, MigrationPlan } from "../../../model/migrations.js"
import type { ProcessRuntime } from "../../../ports/process-runtime.js"
import { Ensure } from "../ensure.js"
import { CASE, type ConformanceCase } from "../conformance-case.js"
import type { ConformanceHarness } from "../harness.js"
import { WORLD_ELEMENT, WORLD_MIGRATION } from "../world/world.js"

const WAIT_ELEMENTS = [WORLD_ELEMENT.reviewOrder, WORLD_ELEMENT.chargePayment]

type PlanningRuntime = ProcessRuntime &
  Required<Pick<ProcessRuntime, "proposeMigration">> &
  Required<Pick<ProcessRuntime, "checkMigration">>

class MigrationPlans {
  static maps(plan: MigrationPlan, mapping: ElementMapping): boolean {
    return plan.mappings.some(
      (candidate) =>
        candidate.sourceElementId === mapping.sourceElementId &&
        candidate.targetElementId === mapping.targetElementId,
    )
  }

  static sameId(elementId: string): ElementMapping {
    return { sourceElementId: ElementId(elementId), targetElementId: ElementId(elementId) }
  }

  static async ifPlanning(
    harness: ConformanceHarness,
    law: string,
    run: (runtime: PlanningRuntime) => Promise<void>,
  ): Promise<void> {
    const { runtime } = harness
    Ensure.that(
      (runtime.proposeMigration === undefined) === (runtime.checkMigration === undefined),
      law,
      "a runtime proposes and checks migration plans, or does neither",
    )
    if (MigrationPlans.plans(runtime)) {
      await run(runtime)
    }
  }

  private static plans(runtime: ProcessRuntime): runtime is PlanningRuntime {
    return runtime.proposeMigration !== undefined && runtime.checkMigration !== undefined
  }
}

const migrationProposal: ConformanceCase = {
  name: CASE.migrationProposal,
  run(harness) {
    return MigrationPlans.ifPlanning(harness, this.name, async (runtime) => {
      const source = harness.world.definitionIds[WORLD_MIGRATION.source]
      const target = harness.world.definitionIds[WORLD_MIGRATION.target]
      const plan = await runtime.proposeMigration(source, target)
      Ensure.that(
        plan.sourceDefinitionId === source && plan.targetDefinitionId === target,
        this.name,
        `the proposal addresses ${plan.sourceDefinitionId} → ${plan.targetDefinitionId}`,
      )
      for (const elementId of WAIT_ELEMENTS) {
        Ensure.that(
          MigrationPlans.maps(plan, MigrationPlans.sameId(elementId)),
          this.name,
          `${elementId} is not mapped onto itself: ${Ensure.describe(plan.mappings)}`,
        )
      }
      const check = await runtime.checkMigration(plan)
      Ensure.that(
        check.problems.length === 0,
        this.name,
        `the proposal has problems: ${Ensure.describe(check.problems)}`,
      )
    })
  },
}

const migrationCheck: ConformanceCase = {
  name: CASE.migrationCheck,
  run(harness) {
    return MigrationPlans.ifPlanning(harness, this.name, async (runtime) => {
      const incompatible: ElementMapping = {
        sourceElementId: ElementId(WORLD_ELEMENT.reviewOrder),
        targetElementId: ElementId(WORLD_ELEMENT.chargePayment),
      }
      const fitting = MigrationPlans.sameId(WORLD_ELEMENT.chargePayment)
      const check = await runtime.checkMigration({
        sourceDefinitionId: harness.world.definitionIds[WORLD_MIGRATION.source],
        targetDefinitionId: harness.world.definitionIds[WORLD_MIGRATION.target],
        mappings: [incompatible, fitting],
      })
      const named = check.problems.filter((problem) => problem.mapping !== undefined)
      Ensure.that(
        named.length === 1 &&
          named[0]?.mapping?.sourceElementId === incompatible.sourceElementId &&
          named[0].mapping.targetElementId === incompatible.targetElementId &&
          named[0].message.trim() !== "",
        this.name,
        `expected one problem for the user task → service task mapping, got ${Ensure.describe(check.problems)}`,
      )
    })
  },
}

export const MIGRATION_PLAN_LAWS: readonly ConformanceCase[] = [migrationProposal, migrationCheck]
