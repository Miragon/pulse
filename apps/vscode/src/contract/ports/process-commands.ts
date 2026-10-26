import type { BulkOperationId, ElementId, IncidentId, InstanceId } from "../model/ids.js"
import type { MigrationPlan } from "../model/migrations.js"

export interface VariableChange {
  readonly name: string
  readonly valueJson: string
  readonly type?: string
}

export interface TokenMove {
  readonly fromElementId: ElementId
  readonly toElementId: ElementId
  readonly reason: string
}

export interface CancelOptions {
  readonly reason?: string
}

export interface ProcessCommands {
  retryIncident(incidentId: IncidentId): Promise<void>
  setVariable(instanceId: InstanceId, change: VariableChange): Promise<void>
  moveToken(instanceId: InstanceId, move: TokenMove): Promise<void>
  cancelInstances(
    instanceIds: readonly InstanceId[],
    options?: CancelOptions,
  ): Promise<BulkOperationId>
  migrateInstances(
    plan: MigrationPlan,
    instanceIds: readonly InstanceId[],
  ): Promise<BulkOperationId>
  stopBulkOperation(bulkOperationId: BulkOperationId): Promise<void>
}
