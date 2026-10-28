import {
  DefinitionId,
  ElementId,
  type ElementMapping,
  type MigrationCheck,
  type MigrationPlan,
  type MigrationProblem,
} from "../../../contract/index.js"
import type { EngineClient, MigrationInstructionView } from "../engine-rest/index.js"

export class MigrationReader {
  constructor(private readonly client: EngineClient) {}

  async proposal(source: DefinitionId, target: DefinitionId): Promise<MigrationPlan> {
    const plan = await this.client.migrationPlan(source, target)
    return {
      sourceDefinitionId: DefinitionId(plan.sourceProcessDefinitionId),
      targetDefinitionId: DefinitionId(plan.targetProcessDefinitionId),
      mappings: plan.instructions.flatMap((instruction) => this.mappingOf(instruction) ?? []),
    }
  }

  async check(plan: MigrationPlan): Promise<MigrationCheck> {
    const report = await this.client.migrationReport({
      sourceProcessDefinitionId: plan.sourceDefinitionId,
      targetProcessDefinitionId: plan.targetDefinitionId,
      instructions: plan.mappings.map((mapping) => ({
        sourceActivityIds: [mapping.sourceElementId],
        targetActivityIds: [mapping.targetElementId],
      })),
    })
    return {
      problems: report.instructionReports.flatMap((instructionReport) => {
        const mapping = this.mappingOf(instructionReport.instruction)
        return instructionReport.failures.map((message): MigrationProblem =>
          mapping === undefined ? { message } : { mapping, message },
        )
      }),
    }
  }

  private mappingOf(instruction: MigrationInstructionView): ElementMapping | undefined {
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
}
