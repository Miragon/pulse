import type {
  BulkOperationId,
  CancelOptions,
  IncidentId,
  InstanceId,
  MigrationPlan,
  ProcessCommands,
  TokenMove,
  VariableChange,
} from '../../contract/index.js';
import type { AuditedEngine, WriteAudit } from './write-audit.js';

export class AuditedCommands implements ProcessCommands {
  constructor(
    private readonly commands: ProcessCommands,
    private readonly engine: AuditedEngine,
    private readonly audit: WriteAudit,
    private readonly signedIn: boolean,
  ) {}

  retryIncident(incidentId: IncidentId): Promise<void> {
    return this.audit.recordWrite(this.engine, {
      operation: 'retryIncident',
      fields: `incident=${incidentId}`,
      run: () => this.commands.retryIncident(incidentId),
    });
  }

  setVariable(instanceId: InstanceId, change: VariableChange): Promise<void> {
    return this.audit.recordWrite(this.engine, {
      operation: 'setVariable',
      fields: `instance=${instanceId} ${this.changeFields(change)}`,
      run: () => this.commands.setVariable(instanceId, change),
    });
  }

  moveToken(instanceId: InstanceId, move: TokenMove): Promise<void> {
    const ends = `from=${JSON.stringify(move.fromElementId)} to=${JSON.stringify(move.toElementId)}`;
    const reason = `reasonChars=${move.reason.trim().length}${this.signedIn ? '' : ' oplog=none'}`;
    return this.audit.recordWrite(this.engine, {
      operation: 'moveToken',
      fields: `instance=${instanceId} ${ends} ${reason}`,
      run: () => this.commands.moveToken(instanceId, move),
    });
  }

  cancelInstances(
    instanceIds: readonly InstanceId[],
    options?: CancelOptions,
  ): Promise<BulkOperationId> {
    this.audit.recordIds(this.engine, 'cancelInstances', instanceIds);
    return this.audit.recordWrite(this.engine, {
      operation: 'cancelInstances',
      fields: `count=${instanceIds.length} reason=${options?.reason === undefined ? 'none' : 'given'}`,
      run: () => this.commands.cancelInstances(instanceIds, options),
      resultFields: (bulkOperationId) => `bulk=${bulkOperationId}`,
    });
  }

  migrateInstances(
    plan: MigrationPlan,
    instanceIds: readonly InstanceId[],
  ): Promise<BulkOperationId> {
    const pairs = plan.mappings.map(
      (mapping) => `${mapping.sourceElementId}>${mapping.targetElementId}`,
    );
    this.audit.recordParts(this.engine, 'migrateInstancesPlan', 'map', pairs);
    this.audit.recordIds(this.engine, 'migrateInstances', instanceIds);
    return this.audit.recordWrite(this.engine, {
      operation: 'migrateInstances',
      fields: `source=${plan.sourceDefinitionId} target=${plan.targetDefinitionId} mappings=${pairs.length} count=${instanceIds.length}${this.signedIn ? '' : ' oplog=none'}`,
      run: () => this.commands.migrateInstances(plan, instanceIds),
      resultFields: (bulkOperationId) => `bulk=${bulkOperationId}`,
    });
  }

  stopBulkOperation(bulkOperationId: BulkOperationId): Promise<void> {
    return this.audit.recordWrite(this.engine, {
      operation: 'stopBulkOperation',
      fields: `bulk=${bulkOperationId}`,
      run: () => this.commands.stopBulkOperation(bulkOperationId),
    });
  }

  private changeFields(change: VariableChange): string {
    const bytes = new TextEncoder().encode(change.valueJson).length;
    return `variable=${JSON.stringify(change.name)} type=${change.type ?? 'inferred'} bytes=${bytes}`;
  }
}
