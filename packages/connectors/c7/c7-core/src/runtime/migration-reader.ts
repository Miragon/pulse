/**
 * Migration planning of the engine contract (`proposeMigration`, `checkMigration`) over the main
 * entry's migration planning rules (`migration-plans.ts`): the engine generates a plan between two
 * versions and validates one, both reading `POST`s that change no event trigger. A mapping is an
 * instruction from one source activity to one target activity; the engine's other instructions
 * are left out, and a failure of such an instruction names no mapping. An answer the rules cannot
 * read fails as `RuntimeError("unexpectedResponse")`.
 */

import {
  DefinitionId,
  ElementId,
  type ElementMapping,
  type MigrationCheck,
  type MigrationPlan,
  type MigrationProblem,
} from "@miragon/pulse-engine-core"
import { type ElementPair, readProblems, readProposal } from "../migration-plans.js"
import type { EnginePort } from "../port.js"

function mappingOf(pair: ElementPair): ElementMapping {
  return {
    sourceElementId: ElementId(pair.sourceElementId),
    targetElementId: ElementId(pair.targetElementId),
  }
}

/** Reads migration plans over the engine's port. */
export class MigrationReader {
  constructor(private readonly port: EnginePort) {}

  /** The plan the engine generates from the version `source` to the version `target`. */
  async proposal(source: DefinitionId, target: DefinitionId): Promise<MigrationPlan> {
    const plan = await readProposal(this.port, source, target)
    return {
      sourceDefinitionId: DefinitionId(plan.sourceDefinitionId),
      targetDefinitionId: DefinitionId(plan.targetDefinitionId),
      mappings: plan.mappings.map(mappingOf),
    }
  }

  /** What the engine finds wrong with `plan`, each problem with its mapping where it has one. */
  async check(plan: MigrationPlan): Promise<MigrationCheck> {
    const problems = await readProblems(this.port, plan)
    return {
      problems: problems.map(({ mapping, message }): MigrationProblem =>
        mapping === undefined ? { message } : { mapping: mappingOf(mapping), message },
      ),
    }
  }
}
