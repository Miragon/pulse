import type { BulkFailure, BulkOperation } from "../model/bulk-operations.js"
import type {
  BpmnProcessId,
  BulkOperationId,
  DefinitionId,
  IncidentId,
  InstanceId,
  TenantId,
} from "../model/ids.js"
import type { MigrationCheck, MigrationPlan } from "../model/migrations.js"
import type {
  IncidentFilter,
  InstanceCount,
  InstanceFilter,
  Page,
  PageRequest,
  VariableConditionKind,
} from "../model/queries.js"
import type {
  CalledProcess,
  DefinitionRef,
  DefinitionSummary,
  ElementStatistics,
  EngineInfo,
  Incident,
  IncidentDetails,
  InstanceDetail,
  InstanceSummary,
  VersionSummary,
} from "../model/read-models.js"

export type CallingVersion = Pick<DefinitionRef, "id" | "tenantId">

export interface ProcessRuntime {
  describeEngine(): Promise<EngineInfo>
  listDefinitions(): Promise<readonly DefinitionSummary[]>
  listVersions(
    bpmnProcessId: BpmnProcessId,
    tenantId: TenantId | null,
  ): Promise<readonly VersionSummary[]>
  getDiagramXml(definitionId: DefinitionId): Promise<string | undefined>
  getElementStatistics(definitionId: DefinitionId): Promise<readonly ElementStatistics[]>
  getCalledProcesses(definition: CallingVersion): Promise<readonly CalledProcess[]>
  searchInstances(filter: InstanceFilter, page: PageRequest): Promise<Page<InstanceSummary>>
  countInstances(filter: InstanceFilter): Promise<InstanceCount>
  refusedVariableConditions?(): readonly VariableConditionKind[]
  listVariableNames(definitionId: DefinitionId): Promise<readonly string[]>
  getInstanceDetail(instanceId: InstanceId): Promise<InstanceDetail | undefined>
  searchIncidents(filter: IncidentFilter, page: PageRequest): Promise<Page<Incident>>
  getIncidentDetails(incidentId: IncidentId): Promise<IncidentDetails | undefined>
  getBulkOperation(bulkOperationId: BulkOperationId): Promise<BulkOperation | undefined>
  getBulkFailures(bulkOperationId: BulkOperationId): Promise<readonly BulkFailure[]>
  proposeMigration?(source: DefinitionId, target: DefinitionId): Promise<MigrationPlan>
  checkMigration?(plan: MigrationPlan): Promise<MigrationCheck>
}
