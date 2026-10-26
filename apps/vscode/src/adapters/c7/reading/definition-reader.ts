import type {
  BpmnProcessId,
  DefinitionId,
  DefinitionRef,
  DefinitionSummary,
  VersionSummary,
} from "../../../contract/index.js"
import { ErrorTranslation } from "../errors/error-translation.js"
import type { Mapper } from "../mapping/mapper.js"
import type { VersionFacts } from "../mapping/version-summary-mapper.js"
import type { DefinitionView, EngineClient } from "../engine-cli/index.js"

export interface DefinitionMappers {
  readonly refs: Mapper<DefinitionView, DefinitionRef>
  readonly versions: Mapper<VersionFacts, VersionSummary[]>
  readonly summaries: Mapper<readonly VersionSummary[], DefinitionSummary[]>
}

export class DefinitionReader {
  constructor(
    private readonly client: EngineClient,
    private readonly mappers: DefinitionMappers,
  ) {}

  async list(): Promise<DefinitionSummary[]> {
    return this.mappers.summaries.map(await this.allVersions())
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
    return new Map(
      statistics.map((row) => [row.definition.id, this.mappers.refs.map(row.definition)]),
    )
  }

  private async allVersions(): Promise<VersionSummary[]> {
    const [statistics, incidents] = await Promise.all([
      this.client.definitionStatistics(),
      this.client.incidentInstances(),
    ])
    return this.mappers.versions
      .map({ statistics, incidents })
      .sort((left, right) => right.definition.version - left.definition.version)
  }
}
