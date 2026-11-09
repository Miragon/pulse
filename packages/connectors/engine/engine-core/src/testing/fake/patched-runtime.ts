import type { BulkFailure, BulkOperation } from "../../model/bulk-operations.js"
import type {
  BpmnProcessId,
  BulkOperationId,
  DefinitionId,
  IncidentId,
  InstanceId,
} from "../../model/ids.js"
import type {
  IncidentFilter,
  InstanceCount,
  InstanceFilter,
  Page,
  PageRequest,
} from "../../model/queries.js"
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
} from "../../model/read-models.js"
import type { ProcessRuntime } from "../../ports/process-runtime.js"

export class PatchedRuntime implements ProcessRuntime {
  readonly refusedVariableConditions?: NonNullable<ProcessRuntime["refusedVariableConditions"]>

  readonly proposeMigration?: NonNullable<ProcessRuntime["proposeMigration"]>

  readonly checkMigration?: NonNullable<ProcessRuntime["checkMigration"]>

  constructor(
    private readonly base: ProcessRuntime,
    private readonly patch: Partial<ProcessRuntime>,
  ) {
    const refused = patch.refusedVariableConditions ?? base.refusedVariableConditions?.bind(base)
    const propose = patch.proposeMigration ?? base.proposeMigration?.bind(base)
    const check = patch.checkMigration ?? base.checkMigration?.bind(base)
    if (refused !== undefined) {
      this.refusedVariableConditions = refused
    }
    if (propose !== undefined) {
      this.proposeMigration = propose
    }
    if (check !== undefined) {
      this.checkMigration = check
    }
  }

  describeEngine(): Promise<EngineInfo> {
    return this.patch.describeEngine?.() ?? this.base.describeEngine()
  }

  listDefinitions(): Promise<readonly DefinitionSummary[]> {
    return this.patch.listDefinitions?.() ?? this.base.listDefinitions()
  }

  listVersions(bpmnProcessId: BpmnProcessId): Promise<readonly VersionSummary[]> {
    return this.patch.listVersions?.(bpmnProcessId) ?? this.base.listVersions(bpmnProcessId)
  }

  getDiagramXml(definitionId: DefinitionId): Promise<string | undefined> {
    return this.patch.getDiagramXml?.(definitionId) ?? this.base.getDiagramXml(definitionId)
  }

  getElementStatistics(definitionId: DefinitionId): Promise<readonly ElementStatistics[]> {
    return (
      this.patch.getElementStatistics?.(definitionId) ??
      this.base.getElementStatistics(definitionId)
    )
  }

  getCalledProcesses(definitionId: DefinitionId): Promise<readonly CalledProcess[]> {
    return (
      this.patch.getCalledProcesses?.(definitionId) ?? this.base.getCalledProcesses(definitionId)
    )
  }

  listVariableNames(definitionId: DefinitionId): Promise<readonly string[]> {
    return this.patch.listVariableNames?.(definitionId) ?? this.base.listVariableNames(definitionId)
  }

  searchInstances(filter: InstanceFilter, page: PageRequest): Promise<Page<InstanceSummary>> {
    return this.patch.searchInstances?.(filter, page) ?? this.base.searchInstances(filter, page)
  }

  countInstances(filter: InstanceFilter): Promise<InstanceCount> {
    return this.patch.countInstances?.(filter) ?? this.base.countInstances(filter)
  }

  getInstanceDetail(instanceId: InstanceId): Promise<InstanceDetail | undefined> {
    return this.patch.getInstanceDetail?.(instanceId) ?? this.base.getInstanceDetail(instanceId)
  }

  searchIncidents(filter: IncidentFilter, page: PageRequest): Promise<Page<Incident>> {
    return this.patch.searchIncidents?.(filter, page) ?? this.base.searchIncidents(filter, page)
  }

  getIncidentDetails(incidentId: IncidentId): Promise<IncidentDetails | undefined> {
    return this.patch.getIncidentDetails?.(incidentId) ?? this.base.getIncidentDetails(incidentId)
  }

  getBulkOperation(bulkOperationId: BulkOperationId): Promise<BulkOperation | undefined> {
    return (
      this.patch.getBulkOperation?.(bulkOperationId) ?? this.base.getBulkOperation(bulkOperationId)
    )
  }

  getBulkFailures(bulkOperationId: BulkOperationId): Promise<readonly BulkFailure[]> {
    return (
      this.patch.getBulkFailures?.(bulkOperationId) ?? this.base.getBulkFailures(bulkOperationId)
    )
  }
}
