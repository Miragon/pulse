import type { BpmnProcessId, DefinitionSummary, VersionSummary } from "@miragon/pulse-engine-core"
import { DefinitionRefs } from "../mapping/definition-refs.js"
import type { CamundaClient, DefinitionView, SearchFilter } from "../rest/index.js"
import { FewAtOnce } from "./few-at-once.js"

const DELETED = "DELETED"

interface Counts {
  readonly running: number
  readonly withIncident: number
}

interface IncidentCounts {
  readonly incidents: number
  readonly incidentsAtLeast?: true
}

const NO_INSTANCES: Counts = { running: 0, withIncident: 0 }
const NO_INCIDENTS: IncidentCounts = { incidents: 0 }

export class DefinitionReader {
  constructor(private readonly client: CamundaClient) {}

  async list(): Promise<DefinitionSummary[]> {
    const [latest, statistics] = await Promise.all([
      this.client.latestDefinitions(),
      this.client.processStatistics(),
    ])
    const counts = new Map<string, Counts>()
    for (const row of statistics) {
      const known = counts.get(row.bpmnProcessId) ?? NO_INSTANCES
      counts.set(row.bpmnProcessId, {
        running: known.running + row.withoutIncident + row.withIncident,
        withIncident: known.withIncident + row.withIncident,
      })
    }
    return FewAtOnce.map([...DefinitionReader.newestOf(latest).values()], async (definition) => {
      const instances = counts.get(definition.bpmnProcessId) ?? NO_INSTANCES
      return {
        latest: DefinitionRefs.of(definition),
        ...instances,
        ...(await this.incidentsOf(
          { processDefinitionId: definition.bpmnProcessId },
          instances.withIncident,
        )),
      }
    })
  }

  async versions(bpmnProcessId: BpmnProcessId): Promise<VersionSummary[]> {
    const [definitions, statistics] = await Promise.all([
      this.client.versionsOf(bpmnProcessId),
      this.client.versionStatistics(bpmnProcessId),
    ])
    const rows = new Map(statistics.map((row) => [row.key, row]))
    const kept = definitions
      .filter((definition) => definition.state !== DELETED)
      .toSorted((left, right) => right.version - left.version)
    return FewAtOnce.map(kept, async (definition) => {
      const row = rows.get(definition.key)
      const withIncident = row?.withIncident ?? 0
      return {
        definition: DefinitionRefs.of(definition),
        running: (row?.withoutIncident ?? 0) + withIncident,
        withIncident,
        ...(await this.incidentsOf({ processDefinitionKey: definition.key }, withIncident)),
      }
    })
  }

  private async incidentsOf(filter: SearchFilter, withIncident: number): Promise<IncidentCounts> {
    if (withIncident === 0) {
      return NO_INCIDENTS
    }
    const found = await this.client.incidents(filter, { limit: 0 })
    return found.capped
      ? { incidents: found.total, incidentsAtLeast: true }
      : { incidents: found.total }
  }

  private static newestOf(definitions: readonly DefinitionView[]): Map<string, DefinitionView> {
    const newest = new Map<string, DefinitionView>()
    for (const definition of definitions) {
      const known = newest.get(definition.bpmnProcessId)
      if (definition.state !== DELETED && (known?.version ?? 0) < definition.version) {
        newest.set(definition.bpmnProcessId, definition)
      }
    }
    return newest
  }
}
