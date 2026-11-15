/**
 * Migration planning of the engine contract (`proposeMigration`, `checkMigration`): the engine
 * generates a plan between two versions and validates one, both reading `POST`s that change no
 * event trigger. A mapping is an instruction from one source activity to one target activity; the
 * engine's other instructions are left out, and a failure of such an instruction names no mapping.
 */

import {
  DefinitionId,
  ElementId,
  type ElementMapping,
  type MigrationCheck,
  type MigrationPlan,
  type MigrationProblem,
} from "@miragon/pulse-engine-core"
import type { EnginePort } from "../port.js"
import {
  instructionReportsOf,
  type MigrationInstructionRow,
  migrationPlanOf,
} from "./migration-rows.js"

function mappingOf(instruction: MigrationInstructionRow): ElementMapping | undefined {
  const [source, ...otherSources] = instruction.sourceActivityIds
  const [target, ...otherTargets] = instruction.targetActivityIds
  if (
    source === undefined ||
    target === undefined ||
    otherSources.length + otherTargets.length > 0
  ) {
    return undefined
  }
  return { sourceElementId: ElementId(source), targetElementId: ElementId(target) }
}

/** Reads migration plans over the engine's port. */
export class MigrationReader {
  constructor(private readonly port: EnginePort) {}

  /** The plan the engine generates from the version `source` to the version `target`. */
  async proposal(source: DefinitionId, target: DefinitionId): Promise<MigrationPlan> {
    const answer = await this.port.json("generateMigrationPlan", {
      pathArgs: [],
      query: {},
      body: {
        sourceProcessDefinitionId: source,
        targetProcessDefinitionId: target,
        updateEventTriggers: false,
      },
    })
    const plan = migrationPlanOf(answer)
    return {
      sourceDefinitionId: DefinitionId(plan.sourceProcessDefinitionId),
      targetDefinitionId: DefinitionId(plan.targetProcessDefinitionId),
      mappings: plan.instructions.flatMap((instruction) => mappingOf(instruction) ?? []),
    }
  }

  /** What the engine finds wrong with `plan`, each problem with its mapping where it has one. */
  async check(plan: MigrationPlan): Promise<MigrationCheck> {
    const answer = await this.port.json("validateMigrationPlan", {
      pathArgs: [],
      query: {},
      body: {
        sourceProcessDefinitionId: plan.sourceDefinitionId,
        targetProcessDefinitionId: plan.targetDefinitionId,
        instructions: plan.mappings.map((mapping) => ({
          sourceActivityIds: [mapping.sourceElementId],
          targetActivityIds: [mapping.targetElementId],
          updateEventTrigger: false,
        })),
      },
    })
    return {
      problems: instructionReportsOf(answer).flatMap((report) => {
        const mapping = mappingOf(report.instruction)
        return report.failures.map((message): MigrationProblem =>
          mapping === undefined ? { message } : { mapping, message },
        )
      }),
    }
  }
}
