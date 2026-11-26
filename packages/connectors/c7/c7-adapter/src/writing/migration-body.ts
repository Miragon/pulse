import { migrationInstructions } from "@miragon/pulse-c7-core"
import type { InstanceId, MigrationPlan } from "@miragon/pulse-engine-core"

export class MigrationBody {
  static of(plan: MigrationPlan, instanceIds: readonly InstanceId[]): string {
    return JSON.stringify({
      migrationPlan: {
        sourceProcessDefinitionId: plan.sourceDefinitionId,
        targetProcessDefinitionId: plan.targetDefinitionId,
        instructions: migrationInstructions(plan.mappings),
      },
      processInstanceIds: instanceIds,
      skipCustomListeners: false,
      skipIoMappings: false,
    })
  }
}
