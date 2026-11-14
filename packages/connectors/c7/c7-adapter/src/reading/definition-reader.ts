import { withIncidentByVersion } from "@miragon/pulse-c7-core"
import type {
  BpmnProcessId,
  DefinitionId,
  DefinitionRef,
  DefinitionSummary,
  VersionSummary,
} from "@miragon/pulse-engine-core"
import { ErrorTranslation } from "../errors/error-translation.js"
import { DefinitionRefs } from "../mapping/definition-refs.js"
import type { EngineClient } from "../engine-rest/index.js"

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
    const [statistics, failing] = await Promise.all([
      this.client.definitionStatistics(),
      this.client.instancesWithIncident({}),
    ])
    const withIncident = withIncidentByVersion(failing)
    return statistics
      .map((row) => ({
        definition: DefinitionRefs.of(row.definition),
        running: row.instances,
        withIncident: withIncident.get(row.definition.id) ?? 0,
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
}
