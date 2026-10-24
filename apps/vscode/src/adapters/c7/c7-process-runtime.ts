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
} from '../../contract/index.js';
import { ErrorTranslation } from './errors/error-translation.js';
import { BulkFailureMapper } from './mapping/bulk-failure-mapper.js';
import { BulkOperationMapper } from './mapping/bulk-operation-mapper.js';
import { CalledElementMapper } from './mapping/called-element-mapper.js';
import { CalledInstanceMapper } from './mapping/called-instance-mapper.js';
import { CalledProcessMapper } from './mapping/called-process-mapper.js';
import { DefinitionRefMapper } from './mapping/definition-ref-mapper.js';
import { DefinitionSummaryMapper } from './mapping/definition-summary-mapper.js';
import { ElementRunMapper } from './mapping/element-run-mapper.js';
import { ElementStatisticsMapper } from './mapping/element-statistics-mapper.js';
import { HistoricDefinitionRefMapper } from './mapping/historic-definition-ref-mapper.js';
import { HistoricSummaryMapper } from './mapping/historic-summary-mapper.js';
import { IncidentDetailsMapper } from './mapping/incident-details-mapper.js';
import { IncidentMapper } from './mapping/incident-mapper.js';
import { IncidentQueryMapper } from './mapping/incident-query-mapper.js';
import { IncidentRowMapper } from './mapping/incident-row-mapper.js';
import { InstanceQueryMapper } from './mapping/instance-query-mapper.js';
import { InstanceSummaryMapper } from './mapping/instance-summary-mapper.js';
import { MigrationCheckMapper } from './mapping/migration-check-mapper.js';
import { MigrationPlanMapper } from './mapping/migration-plan-mapper.js';
import { MigrationRequestMapper } from './mapping/migration-request-mapper.js';
import { VariableMapper } from './mapping/variable-mapper.js';
import { VersionSummaryMapper } from './mapping/version-summary-mapper.js';
import { WaitStateMapper } from './mapping/wait-state-mapper.js';
import type { EngineClient } from './engine-cli/index.js';
import { BulkOperationReader } from './reading/bulk-operation-reader.js';
import { CalledProcessReader } from './reading/called-process-reader.js';
import { DefinitionReader } from './reading/definition-reader.js';
import { ElementStatisticsReader } from './reading/element-statistics-reader.js';
import { EngineReader } from './reading/engine-reader.js';
import { IncidentDetailsReader } from './reading/incident-details-reader.js';
import { IncidentSearch } from './reading/incident-search.js';
import { InstanceDetailReader } from './reading/instance-detail-reader.js';
import { InstanceSearch } from './reading/instance-search.js';
import { MigrationReader } from './reading/migration-reader.js';

export interface C7Readers {
  readonly engine: EngineReader;
  readonly definitions: DefinitionReader;
  readonly statistics: ElementStatisticsReader;
  readonly calls: CalledProcessReader;
  readonly instances: InstanceSearch;
  readonly instanceDetails: InstanceDetailReader;
  readonly incidents: IncidentSearch;
  readonly incidentDetails: IncidentDetailsReader;
  readonly bulkOperations: BulkOperationReader;
  readonly migrations: MigrationReader;
}

export class C7ProcessRuntime implements ProcessRuntime {
  constructor(private readonly readers: C7Readers) {}

  static create(client: EngineClient): C7ProcessRuntime {
    const refs = new DefinitionRefMapper();
    const historicRefs = new HistoricDefinitionRefMapper();
    const definitions = new DefinitionReader(client, {
      refs,
      versions: new VersionSummaryMapper(refs),
      summaries: new DefinitionSummaryMapper(),
    });
    return new C7ProcessRuntime({
      engine: new EngineReader(client),
      definitions,
      statistics: new ElementStatisticsReader(client, new ElementStatisticsMapper()),
      calls: new CalledProcessReader(client, {
        calledElements: new CalledElementMapper(),
        calledProcesses: new CalledProcessMapper(refs),
      }),
      instances: new InstanceSearch(client, {
        queries: new InstanceQueryMapper(),
        summaries: new HistoricSummaryMapper(historicRefs),
      }),
      instanceDetails: new InstanceDetailReader(client, {
        summaries: new InstanceSummaryMapper(refs),
        waits: new WaitStateMapper(),
        incidents: new IncidentMapper(),
        called: new CalledInstanceMapper(),
        variables: new VariableMapper(),
        runs: new ElementRunMapper(),
        refs,
        historicRefs,
      }),
      incidents: new IncidentSearch(client, definitions, {
        queries: new IncidentQueryMapper(),
        rows: new IncidentRowMapper(),
      }),
      incidentDetails: new IncidentDetailsReader(client, new IncidentDetailsMapper()),
      bulkOperations: new BulkOperationReader(client, {
        operations: new BulkOperationMapper(),
        failures: new BulkFailureMapper(),
      }),
      migrations: new MigrationReader(client, {
        plans: new MigrationPlanMapper(),
        requests: new MigrationRequestMapper(),
        checks: new MigrationCheckMapper(),
      }),
    });
  }

  describeEngine(): Promise<EngineInfo> {
    return ErrorTranslation.translated(() => this.readers.engine.describe());
  }

  listDefinitions(): Promise<readonly DefinitionSummary[]> {
    return ErrorTranslation.translated(() => this.readers.definitions.list());
  }

  listVersions(bpmnProcessId: BpmnProcessId): Promise<readonly VersionSummary[]> {
    return ErrorTranslation.translated(() => this.readers.definitions.versions(bpmnProcessId));
  }

  getDiagramXml(definitionId: DefinitionId): Promise<string | undefined> {
    return ErrorTranslation.translated(() => this.readers.definitions.diagramXml(definitionId));
  }

  getElementStatistics(definitionId: DefinitionId): Promise<readonly ElementStatistics[]> {
    return ErrorTranslation.translated(() => this.readers.statistics.of(definitionId));
  }

  getCalledProcesses(definitionId: DefinitionId): Promise<readonly CalledProcess[]> {
    return ErrorTranslation.translated(() => this.readers.calls.read(definitionId));
  }

  searchInstances(filter: InstanceFilter, page: PageRequest): Promise<Page<InstanceSummary>> {
    return ErrorTranslation.translated(() => this.readers.instances.search(filter, page));
  }

  countInstances(filter: InstanceFilter): Promise<number> {
    return ErrorTranslation.translated(() => this.readers.instances.count(filter));
  }

  getInstanceDetail(instanceId: InstanceId): Promise<InstanceDetail | undefined> {
    return ErrorTranslation.translated(() => this.readers.instanceDetails.read(instanceId));
  }

  searchIncidents(filter: IncidentFilter, page: PageRequest): Promise<Page<Incident>> {
    return ErrorTranslation.translated(() => this.readers.incidents.search(filter, page));
  }

  getIncidentDetails(incidentId: IncidentId): Promise<IncidentDetails | undefined> {
    return ErrorTranslation.translated(() => this.readers.incidentDetails.read(incidentId));
  }

  getBulkOperation(bulkOperationId: BulkOperationId): Promise<BulkOperation | undefined> {
    return ErrorTranslation.translated(() => this.readers.bulkOperations.read(bulkOperationId));
  }

  getBulkFailures(bulkOperationId: BulkOperationId): Promise<readonly BulkFailure[]> {
    return ErrorTranslation.translated(() => this.readers.bulkOperations.failures(bulkOperationId));
  }

  proposeMigration(source: DefinitionId, target: DefinitionId): Promise<MigrationPlan> {
    return ErrorTranslation.translated(() => this.readers.migrations.proposal(source, target));
  }

  checkMigration(plan: MigrationPlan): Promise<MigrationCheck> {
    return ErrorTranslation.translated(() => this.readers.migrations.check(plan));
  }
}
