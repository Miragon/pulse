import type { InstanceId, MigrationPlan } from '../../../contract/index.js';

export class MigrationBody {
  static of(plan: MigrationPlan, instanceIds: readonly InstanceId[]): string {
    return JSON.stringify({
      migrationPlan: {
        sourceProcessDefinitionId: plan.sourceDefinitionId,
        targetProcessDefinitionId: plan.targetDefinitionId,
        instructions: plan.mappings.map((mapping) => ({
          sourceActivityIds: [mapping.sourceElementId],
          targetActivityIds: [mapping.targetElementId],
          updateEventTrigger: false,
        })),
      },
      processInstanceIds: instanceIds,
      skipCustomListeners: false,
      skipIoMappings: false,
    });
  }
}
