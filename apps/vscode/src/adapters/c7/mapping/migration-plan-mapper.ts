import {
  DefinitionId,
  ElementId,
  type ElementMapping,
  type MigrationPlan,
} from "../../../contract/index.js"
import type { MigrationInstructionView, MigrationPlanView } from "../engine-rest/index.js"
import type { Mapper } from "./mapper.js"

export class MigrationPlanMapper implements Mapper<MigrationPlanView, MigrationPlan> {
  static mappingOf(instruction: MigrationInstructionView): ElementMapping | undefined {
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

  map(plan: MigrationPlanView): MigrationPlan {
    return {
      sourceDefinitionId: DefinitionId(plan.sourceProcessDefinitionId),
      targetDefinitionId: DefinitionId(plan.targetProcessDefinitionId),
      mappings: plan.instructions.flatMap((instruction) => {
        const mapping = MigrationPlanMapper.mappingOf(instruction)
        return mapping === undefined ? [] : [mapping]
      }),
    }
  }
}
