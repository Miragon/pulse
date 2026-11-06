import type {
  BpmnProcessId,
  BulkFailure,
  BulkOperation,
  CalledProcess,
  DefinitionId,
  DefinitionSummary,
  ElementStatistics,
  EngineInfo,
  Incident,
  IncidentDetails,
  IncidentFilter,
  IncidentId,
  InstanceCount,
  InstanceDetail,
  InstanceFilter,
  InstanceId,
  InstanceSummary,
  Page,
  PageRequest,
  ProcessRuntime,
  VariableConditionKind,
  VersionSummary,
} from "../../contract/index.js"
import { ErrorTranslation } from "./errors/error-translation.js"
import { IncidentTexts } from "./mapping/incident-texts.js"
import { Keys } from "./mapping/keys.js"
import { CalledProcessReader } from "./reading/called-process-reader.js"
import { DefinitionReader } from "./reading/definition-reader.js"
import { DefinitionRefsCache } from "./reading/definition-refs-cache.js"
import { Diagrams } from "./reading/diagrams.js"
import { ElementStatisticsReader } from "./reading/element-statistics-reader.js"
import { IncidentSearch } from "./reading/incident-search.js"
import { InstanceDetailReader } from "./reading/instance-detail-reader.js"
import { InstanceSearch } from "./reading/instance-search.js"
import { VariableNameReader } from "./reading/variable-name-reader.js"
import { VersionFloor } from "./reading/version-floor.js"
import type { CamundaClient } from "./rest/index.js"

const PRODUCT = "Camunda 8"
const REFUSED_CONDITIONS: readonly VariableConditionKind[] = ["ordering", "date"]

interface Readers {
  readonly floor: VersionFloor
  readonly diagrams: Diagrams
  readonly definitions: DefinitionReader
  readonly statistics: ElementStatisticsReader
  readonly calls: CalledProcessReader
  readonly instances: InstanceSearch
  readonly variableNames: VariableNameReader
  readonly details: InstanceDetailReader
  readonly incidents: IncidentSearch
}

export class C8ProcessRuntime implements ProcessRuntime {
  private constructor(
    private readonly client: CamundaClient,
    private readonly readers: Readers,
  ) {}

  static create(client: CamundaClient): C8ProcessRuntime {
    const diagrams = new Diagrams(client)
    return new C8ProcessRuntime(client, {
      floor: new VersionFloor(client),
      diagrams,
      definitions: new DefinitionReader(client),
      statistics: new ElementStatisticsReader(client, diagrams),
      calls: new CalledProcessReader(client, diagrams),
      instances: new InstanceSearch(client),
      variableNames: new VariableNameReader(client),
      details: new InstanceDetailReader(client, diagrams),
      incidents: new IncidentSearch(client, new DefinitionRefsCache(client)),
    })
  }

  refusedVariableConditions(): readonly VariableConditionKind[] {
    return REFUSED_CONDITIONS
  }

  describeEngine(): Promise<EngineInfo> {
    return this.read(async () => ({
      product: PRODUCT,
      version: await this.readers.floor.checked(),
    }))
  }

  listDefinitions(): Promise<readonly DefinitionSummary[]> {
    return this.read(() => this.readers.definitions.list())
  }

  listVersions(bpmnProcessId: BpmnProcessId): Promise<readonly VersionSummary[]> {
    return this.read(() => this.readers.definitions.versions(bpmnProcessId))
  }

  getDiagramXml(definitionId: DefinitionId): Promise<string | undefined> {
    return this.read(() => this.readers.diagrams.xml(definitionId))
  }

  getElementStatistics(definitionId: DefinitionId): Promise<readonly ElementStatistics[]> {
    return this.read(() => this.readers.statistics.read(definitionId))
  }

  getCalledProcesses(definitionId: DefinitionId): Promise<readonly CalledProcess[]> {
    return this.read(() => this.readers.calls.read(definitionId))
  }

  searchInstances(filter: InstanceFilter, page: PageRequest): Promise<Page<InstanceSummary>> {
    return this.read(() => this.readers.instances.search(filter, page))
  }

  countInstances(filter: InstanceFilter): Promise<InstanceCount> {
    return this.read(() => this.readers.instances.count(filter))
  }

  listVariableNames(definitionId: DefinitionId): Promise<readonly string[]> {
    return this.read(() => this.readers.variableNames.read(definitionId))
  }

  getInstanceDetail(instanceId: InstanceId): Promise<InstanceDetail | undefined> {
    return this.read(() => this.readers.details.read(instanceId))
  }

  searchIncidents(filter: IncidentFilter, page: PageRequest): Promise<Page<Incident>> {
    return this.read(() => this.readers.incidents.search(filter, page))
  }

  getIncidentDetails(incidentId: IncidentId): Promise<IncidentDetails | undefined> {
    return this.read(async () => {
      const incident = Keys.isKey(incidentId) ? await this.client.incident(incidentId) : undefined
      return incident === undefined ? undefined : IncidentTexts.details(incident.message)
    })
  }

  getBulkOperation(): Promise<BulkOperation | undefined> {
    return Promise.resolve(undefined)
  }

  getBulkFailures(): Promise<readonly BulkFailure[]> {
    return Promise.resolve([])
  }

  private read<Result>(work: () => Promise<Result>): Promise<Result> {
    return ErrorTranslation.translated(async () => {
      await this.readers.floor.checked()
      return work()
    })
  }
}
