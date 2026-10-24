import type { MigrationPlan } from '../../../contract/index.js';
import type { MigrationPlanView } from '../engine-cli/index.js';
import type { Mapper } from './mapper.js';

export class MigrationRequestMapper implements Mapper<MigrationPlan, MigrationPlanView> {
  map(plan: MigrationPlan): MigrationPlanView {
    return {
      sourceProcessDefinitionId: plan.sourceDefinitionId,
      targetProcessDefinitionId: plan.targetDefinitionId,
      instructions: plan.mappings.map((mapping) => ({
        sourceActivityIds: [mapping.sourceElementId],
        targetActivityIds: [mapping.targetElementId],
      })),
    };
  }
}
