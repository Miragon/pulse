import type { DefinitionRef, VersionSummary } from "../../../contract/index.js"
import type {
  DefinitionStatisticsView,
  DefinitionView,
  IncidentInstanceView,
} from "../engine-cli/index.js"
import type { Mapper } from "./mapper.js"

export interface VersionFacts {
  readonly statistics: readonly DefinitionStatisticsView[]
  readonly incidents: readonly IncidentInstanceView[]
}

export class VersionSummaryMapper implements Mapper<VersionFacts, VersionSummary[]> {
  constructor(private readonly definitions: Mapper<DefinitionView, DefinitionRef>) {}

  map({ statistics, incidents }: VersionFacts): VersionSummary[] {
    const instancesWithIncident = this.instancesWithIncidentOf(incidents)
    return statistics.map((row) => ({
      definition: this.definitions.map(row.definition),
      running: row.instances,
      withIncident: instancesWithIncident.get(row.definition.id)?.size ?? 0,
    }))
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
