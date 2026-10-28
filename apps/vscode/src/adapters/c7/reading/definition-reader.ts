import type {
  BpmnProcessId,
  DefinitionId,
  DefinitionRef,
  DefinitionSummary,
  VersionSummary,
} from "../../../contract/index.js"
import { ErrorTranslation } from "../errors/error-translation.js"
import { DefinitionRefs } from "../mapping/definition-refs.js"
import type { EngineClient, IncidentInstanceView } from "../engine-rest/index.js"

export class DefinitionReader {
  constructor(private readonly client: EngineClient) {}

  async list(): Promise<DefinitionSummary[]> {
    const byProcess = new Map<string, VersionSummary[]>()
    for (const version of await this.allVersions()) {
      const key = version.definition.bpmnProcessId
      byProcess.set(key, [...(byProcess.get(key) ?? []), version])
    }
    return [...byProcess.keys()]
      .sort((left, right) => left.localeCompare(right))
      .flatMap((key) => this.summaryOf(byProcess.get(key) ?? []))
  }

  async versions(bpmnProcessId: BpmnProcessId): Promise<VersionSummary[]> {
    const versions = await this.allVersions()
    return versions.filter((version) => version.definition.bpmnProcessId === bpmnProcessId)
  }

  diagramXml(definitionId: DefinitionId): Promise<string | undefined> {
    return ErrorTranslation.unlessMissing(() => this.client.diagramXml(definitionId))
  }

  async refsById(): Promise<ReadonlyMap<string, DefinitionRef>> {
    const statistics = await this.client.definitionStatistics()
    return new Map(statistics.map((row) => [row.definition.id, DefinitionRefs.of(row.definition)]))
  }

  private async allVersions(): Promise<VersionSummary[]> {
    const [statistics, incidents] = await Promise.all([
      this.client.definitionStatistics(),
      this.client.incidentInstances(),
    ])
    const instancesWithIncident = this.instancesWithIncidentOf(incidents)
    return statistics
      .map((row) => ({
        definition: DefinitionRefs.of(row.definition),
        running: row.instances,
        withIncident: instancesWithIncident.get(row.definition.id)?.size ?? 0,
      }))
      .sort((left, right) => right.definition.version - left.definition.version)
  }

  private summaryOf(versions: readonly VersionSummary[]): DefinitionSummary[] {
    const [latest] = versions
    if (latest === undefined) {
      return []
    }
    return [
      {
        latest: latest.definition,
        running: versions.reduce((sum, version) => sum + version.running, 0),
        withIncident: versions.reduce((sum, version) => sum + version.withIncident, 0),
      },
    ]
  }

  private instancesWithIncidentOf(
    incidents: readonly IncidentInstanceView[],
  ): ReadonlyMap<string, ReadonlySet<string>> {
    const byDefinition = new Map<string, Set<string>>()
    for (const { processDefinitionId, processInstanceId } of incidents) {
      if (processDefinitionId !== undefined && processInstanceId !== undefined) {
        const instances = byDefinition.get(processDefinitionId) ?? new Set<string>()
        instances.add(processInstanceId)
        byDefinition.set(processDefinitionId, instances)
      }
    }
    return byDefinition
  }
}
