import type { BulkFailure, BulkOperation } from "../model/bulk-operations.js"
import type {
  BpmnProcessId,
  BulkOperationId,
  DefinitionId,
  IncidentId,
  InstanceId,
} from "../model/ids.js"
import type { MigrationCheck, MigrationPlan } from "../model/migrations.js"
import type { IncidentFilter, InstanceFilter, Page, PageRequest } from "../model/queries.js"
import type {
  CalledProcess,
  DefinitionSummary,
  ElementStatistics,
  EngineInfo,
  Incident,
  IncidentDetails,
  InstanceDetail,
  InstanceSummary,
  VersionSummary,
} from "../model/read-models.js"

export interface ProcessRuntime {
  describeEngine(): Promise<EngineInfo>
  listDefinitions(): Promise<readonly DefinitionSummary[]>
  listVersions(bpmnProcessId: BpmnProcessId): Promise<readonly VersionSummary[]>
  getDiagramXml(definitionId: DefinitionId): Promise<string | undefined>
  getElementStatistics(definitionId: DefinitionId): Promise<readonly ElementStatistics[]>
  getCalledProcesses(definitionId: DefinitionId): Promise<readonly CalledProcess[]>
  searchInstances(filter: InstanceFilter, page: PageRequest): Promise<Page<InstanceSummary>>
  countInstances(filter: InstanceFilter): Promise<number>
  listVariableNames(definitionId: DefinitionId): Promise<readonly string[]>
  getInstanceDetail(instanceId: InstanceId): Promise<InstanceDetail | undefined>
  searchIncidents(filter: IncidentFilter, page: PageRequest): Promise<Page<Incident>>
  getIncidentDetails(incidentId: IncidentId): Promise<IncidentDetails | undefined>
  getBulkOperation(bulkOperationId: BulkOperationId): Promise<BulkOperation | undefined>
  getBulkFailures(bulkOperationId: BulkOperationId): Promise<readonly BulkFailure[]>
  proposeMigration(source: DefinitionId, target: DefinitionId): Promise<MigrationPlan>
  checkMigration(plan: MigrationPlan): Promise<MigrationCheck>
}
