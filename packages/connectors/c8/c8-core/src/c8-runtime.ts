import type {
  BpmnProcessId,
  BulkFailure,
  BulkOperation,
  CalledProcess,
  CallingVersion,
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
  TenantId,
  VariableConditionKind,
  VersionSummary,
} from "@miragon/pulse-engine-core"
import { C8Failures, type C8WordsOf } from "./c8-failures.js"
import { IncidentTexts } from "./mapping/incident-texts.js"
import { Keys } from "./mapping/keys.js"
import type { CamundaTransport } from "./port/camunda-transport.js"
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
import { type CamundaClient, RestCamundaClient } from "./rest/index.js"

const PRODUCT = "Camunda 8"
const REFUSED_CONDITIONS: readonly VariableConditionKind[] = ["ordering", "date"]

export interface C8RuntimeOptions {
  readonly wordsOf: C8WordsOf
}

interface C8Readers {
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

export class C8Runtime implements ProcessRuntime {
  private constructor(
    private readonly client: CamundaClient,
    private readonly readers: C8Readers,
    private readonly failures: C8Failures,
  ) {}

  static over(transport: CamundaTransport, options: C8RuntimeOptions): C8Runtime {
    const client = new RestCamundaClient(transport)
    const diagrams = new Diagrams(client)
    const readers: C8Readers = {
      floor: new VersionFloor(client),
      diagrams,
      definitions: new DefinitionReader(client),
      statistics: new ElementStatisticsReader(client, diagrams),
      calls: new CalledProcessReader(client, diagrams),
      instances: new InstanceSearch(client),
      variableNames: new VariableNameReader(client),
      details: new InstanceDetailReader(client, diagrams),
      incidents: new IncidentSearch(client, new DefinitionRefsCache(client)),
    }
    return new C8Runtime(client, readers, new C8Failures(transport, options.wordsOf))
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

  listVersions(
    bpmnProcessId: BpmnProcessId,
    tenantId: TenantId | null,
  ): Promise<readonly VersionSummary[]> {
    return this.read(() => this.readers.definitions.versions(bpmnProcessId, tenantId))
  }

  getDiagramXml(definitionId: DefinitionId): Promise<string | undefined> {
    return this.read(() => this.readers.diagrams.xml(definitionId))
  }

  getElementStatistics(definitionId: DefinitionId): Promise<readonly ElementStatistics[]> {
    return this.read(() => this.readers.statistics.read(definitionId))
  }

  getCalledProcesses(definition: CallingVersion): Promise<readonly CalledProcess[]> {
    return this.read(() => this.readers.calls.read(definition))
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

  private async read<Result>(work: () => Promise<Result>): Promise<Result> {
    try {
      await this.readers.floor.checked()
      return await work()
    } catch (error: unknown) {
      throw this.failures.errorOf(error)
    }
  }
}
