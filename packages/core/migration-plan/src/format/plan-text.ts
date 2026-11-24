import type { MigrationPlanDefinition } from "./plan-definition.js"

export class MigrationPlanText {
  static of(plan: MigrationPlanDefinition): string {
    throw new Error(`MigrationPlanText.of has no body for ${plan.bpmnProcessId}`)
  }
}
