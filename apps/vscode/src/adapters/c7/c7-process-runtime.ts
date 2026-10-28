import type {
  BpmnProcessId,
  BulkFailure,
  BulkOperation,
  BulkOperationId,
  CalledProcess,
  DefinitionId,
  DefinitionSummary,
  ElementStatistics,
  EngineInfo,
  Incident,
  IncidentDetails,
  IncidentFilter,
  IncidentId,
  InstanceDetail,
  InstanceFilter,
  InstanceId,
  InstanceSummary,
  MigrationCheck,
  MigrationPlan,
  Page,
  PageRequest,
  ProcessRuntime,
  VersionSummary,
} from "../../contract/index.js"
import { ErrorTranslation } from "./errors/error-translation.js"
import type { EngineClient } from "./engine-rest/index.js"
import { BulkOperationReader } from "./reading/bulk-operation-reader.js"
import { CalledProcessReader } from "./reading/called-process-reader.js"
import { DefinitionReader } from "./reading/definition-reader.js"
import { ElementStatisticsReader } from "./reading/element-statistics-reader.js"
import { EngineReader } from "./reading/engine-reader.js"
import { IncidentDetailsReader } from "./reading/incident-details-reader.js"
import { IncidentSearch } from "./reading/incident-search.js"
import { InstanceDetailReader } from "./reading/instance-detail-reader.js"
import { InstanceSearch } from "./reading/instance-search.js"
import { MigrationReader } from "./reading/migration-reader.js"
import { VariableNameReader } from "./reading/variable-name-reader.js"

export interface C7Readers {
  readonly engine: EngineReader
  readonly definitions: DefinitionReader
  readonly statistics: ElementStatisticsReader
  readonly calls: CalledProcessReader
  readonly instances: InstanceSearch
  readonly variableNames: VariableNameReader
  readonly instanceDetails: InstanceDetailReader
  readonly incidents: IncidentSearch
  readonly incidentDetails: IncidentDetailsReader
  readonly bulkOperations: BulkOperationReader
  readonly migrations: MigrationReader
}

export class C7ProcessRuntime implements ProcessRuntime {
  constructor(private readonly readers: C7Readers) {}

  static create(client: EngineClient): C7ProcessRuntime {
    const definitions = new DefinitionReader(client)
    return new C7ProcessRuntime({
      engine: new EngineReader(client),
      definitions,
      statistics: new ElementStatisticsReader(client),
      calls: new CalledProcessReader(client),
      instances: new InstanceSearch(client),
      variableNames: new VariableNameReader(client),
      instanceDetails: new InstanceDetailReader(client),
      incidents: new IncidentSearch(client, definitions),
      incidentDetails: new IncidentDetailsReader(client),
      bulkOperations: new BulkOperationReader(client),
      migrations: new MigrationReader(client),
    })
  }

  describeEngine(): Promise<EngineInfo> {
    return ErrorTranslation.translated(() => this.readers.engine.describe())
  }

  listDefinitions(): Promise<readonly DefinitionSummary[]> {
    return ErrorTranslation.translated(() => this.readers.definitions.list())
  }

  listVersions(bpmnProcessId: BpmnProcessId): Promise<readonly VersionSummary[]> {
    return ErrorTranslation.translated(() => this.readers.definitions.versions(bpmnProcessId))
  }

  getDiagramXml(definitionId: DefinitionId): Promise<string | undefined> {
    return ErrorTranslation.translated(() => this.readers.definitions.diagramXml(definitionId))
  }

  getElementStatistics(definitionId: DefinitionId): Promise<readonly ElementStatistics[]> {
    return ErrorTranslation.translated(() => this.readers.statistics.of(definitionId))
  }

  getCalledProcesses(definitionId: DefinitionId): Promise<readonly CalledProcess[]> {
    return ErrorTranslation.translated(() => this.readers.calls.read(definitionId))
  }

  searchInstances(filter: InstanceFilter, page: PageRequest): Promise<Page<InstanceSummary>> {
    return ErrorTranslation.translated(() => this.readers.instances.search(filter, page))
  }

  countInstances(filter: InstanceFilter): Promise<number> {
    return ErrorTranslation.translated(() => this.readers.instances.count(filter))
  }

  listVariableNames(definitionId: DefinitionId): Promise<readonly string[]> {
    return ErrorTranslation.translated(() => this.readers.variableNames.names(definitionId))
  }

  getInstanceDetail(instanceId: InstanceId): Promise<InstanceDetail | undefined> {
    return ErrorTranslation.translated(() => this.readers.instanceDetails.read(instanceId))
  }

  searchIncidents(filter: IncidentFilter, page: PageRequest): Promise<Page<Incident>> {
    return ErrorTranslation.translated(() => this.readers.incidents.search(filter, page))
  }

  getIncidentDetails(incidentId: IncidentId): Promise<IncidentDetails | undefined> {
    return ErrorTranslation.translated(() => this.readers.incidentDetails.read(incidentId))
  }

  getBulkOperation(bulkOperationId: BulkOperationId): Promise<BulkOperation | undefined> {
    return ErrorTranslation.translated(() => this.readers.bulkOperations.read(bulkOperationId))
  }

  getBulkFailures(bulkOperationId: BulkOperationId): Promise<readonly BulkFailure[]> {
    return ErrorTranslation.translated(() => this.readers.bulkOperations.failures(bulkOperationId))
  }

  proposeMigration(source: DefinitionId, target: DefinitionId): Promise<MigrationPlan> {
    return ErrorTranslation.translated(() => this.readers.migrations.proposal(source, target))
  }

  checkMigration(plan: MigrationPlan): Promise<MigrationCheck> {
    return ErrorTranslation.translated(() => this.readers.migrations.check(plan))
  }
}
