import type { BulkOperationId, DefinitionId, IncidentId, InstanceId } from '../model/ids.js';
import type { ProcessRuntime } from '../ports/process-runtime.js';
import type { DeploymentAlias, InstanceAlias } from './world/world.js';

export interface UnknownIds {
  readonly definitionId: DefinitionId;
  readonly instanceId: InstanceId;
  readonly incidentId: IncidentId;
  readonly bulkOperationId: BulkOperationId;
}

export interface SeededWorld {
  readonly definitionIds: Readonly<Record<DeploymentAlias, DefinitionId>>;
  readonly instanceIds: Readonly<Record<InstanceAlias, InstanceId>>;
  readonly unknown: UnknownIds;
}

export interface ConformanceHarness {
  readonly runtime: ProcessRuntime;
  readonly unreachableRuntime: ProcessRuntime;
  readonly world: SeededWorld;
}

export type PrepareHarness = () => Promise<ConformanceHarness>;
