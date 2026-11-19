import type { BoardReads } from "@miragon/pulse-board/builder"
import type {
  DefinitionId,
  DefinitionSummary,
  ElementStatistics,
  EngineInfo,
  Incident,
  IncidentFilter,
  InstanceCount,
  InstanceFilter,
  InstanceSummary,
  Page,
  PageRequest,
  ProcessRuntime,
} from "@miragon/pulse-engine-core"
import type { SharedDefinitions } from "../refresh/shared-definitions.js"

export class BoardRuntime implements BoardReads {
  private readonly diagrams = new Map<DefinitionId, Promise<string | undefined>>()

  constructor(
    private readonly runtime: ProcessRuntime,
    private readonly definitions: SharedDefinitions,
  ) {}

  describeEngine(): Promise<EngineInfo> {
    return this.runtime.describeEngine()
  }

  listDefinitions(): Promise<readonly DefinitionSummary[]> {
    return this.definitions.read(0)
  }

  countInstances(filter: InstanceFilter): Promise<InstanceCount> {
    return this.runtime.countInstances(filter)
  }

  searchInstances(filter: InstanceFilter, page: PageRequest): Promise<Page<InstanceSummary>> {
    return this.runtime.searchInstances(filter, page)
  }

  getDiagramXml(definitionId: DefinitionId): Promise<string | undefined> {
    const known = this.diagrams.get(definitionId)
    if (known !== undefined) {
      return known
    }
    const reading = this.runtime.getDiagramXml(definitionId)
    this.diagrams.set(definitionId, reading)
    return reading
  }

  getElementStatistics(definitionId: DefinitionId): Promise<readonly ElementStatistics[]> {
    return this.runtime.getElementStatistics(definitionId)
  }

  searchIncidents(filter: IncidentFilter, page: PageRequest): Promise<Page<Incident>> {
    return this.runtime.searchIncidents(filter, page)
  }
}
