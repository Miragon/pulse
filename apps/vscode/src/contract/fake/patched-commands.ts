import type { BulkOperationId, IncidentId, InstanceId } from '../model/ids.js';
import type { MigrationPlan } from '../model/migrations.js';
import type {
  CancelOptions,
  ProcessCommands,
  TokenMove,
  VariableChange,
} from '../ports/process-commands.js';

export class PatchedCommands implements ProcessCommands {
  constructor(
    private readonly base: ProcessCommands,
    private readonly patch: Partial<ProcessCommands>,
  ) {}

  retryIncident(incidentId: IncidentId): Promise<void> {
    return this.patch.retryIncident?.(incidentId) ?? this.base.retryIncident(incidentId);
  }

  setVariable(instanceId: InstanceId, change: VariableChange): Promise<void> {
    return (
      this.patch.setVariable?.(instanceId, change) ?? this.base.setVariable(instanceId, change)
    );
  }

  moveToken(instanceId: InstanceId, move: TokenMove): Promise<void> {
    return this.patch.moveToken?.(instanceId, move) ?? this.base.moveToken(instanceId, move);
  }

  cancelInstances(
    instanceIds: readonly InstanceId[],
    options?: CancelOptions,
  ): Promise<BulkOperationId> {
    return (
      this.patch.cancelInstances?.(instanceIds, options) ??
      this.base.cancelInstances(instanceIds, options)
    );
  }

  migrateInstances(
    plan: MigrationPlan,
    instanceIds: readonly InstanceId[],
  ): Promise<BulkOperationId> {
    return (
      this.patch.migrateInstances?.(plan, instanceIds) ??
      this.base.migrateInstances(plan, instanceIds)
    );
  }

  stopBulkOperation(bulkOperationId: BulkOperationId): Promise<void> {
    return (
      this.patch.stopBulkOperation?.(bulkOperationId) ??
      this.base.stopBulkOperation(bulkOperationId)
    );
  }
}
