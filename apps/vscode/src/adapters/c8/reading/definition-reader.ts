import type { BpmnProcessId, DefinitionSummary, VersionSummary } from "../../../contract/index.js"
import { DefinitionRefs } from "../mapping/definition-refs.js"
import type { CamundaClient, DefinitionView } from "../rest/index.js"

const DELETED = "DELETED"

interface Counts {
  readonly running: number
  readonly withIncident: number
}

export class DefinitionReader {
  constructor(private readonly client: CamundaClient) {}

  async list(): Promise<DefinitionSummary[]> {
    const [latest, statistics] = await Promise.all([
      this.client.latestDefinitions(),
      this.client.processStatistics(),
    ])
    const counts = new Map<string, Counts>()
    for (const row of statistics) {
      const known = counts.get(row.bpmnProcessId) ?? { running: 0, withIncident: 0 }
      counts.set(row.bpmnProcessId, {
        running: known.running + row.withoutIncident + row.withIncident,
        withIncident: known.withIncident + row.withIncident,
      })
    }
    return [...this.newestOf(latest).values()].map((definition) => ({
      latest: DefinitionRefs.of(definition),
      ...(counts.get(definition.bpmnProcessId) ?? { running: 0, withIncident: 0 }),
    }))
  }

  async versions(bpmnProcessId: BpmnProcessId): Promise<VersionSummary[]> {
    const [definitions, statistics] = await Promise.all([
      this.client.versionsOf(bpmnProcessId),
      this.client.versionStatistics(bpmnProcessId),
    ])
    const rows = new Map(statistics.map((row) => [row.key, row]))
    return definitions
      .filter((definition) => definition.state !== DELETED)
      .toSorted((left, right) => right.version - left.version)
      .map((definition) => {
        const row = rows.get(definition.key)
        const withIncident = row?.withIncident ?? 0
        return {
          definition: DefinitionRefs.of(definition),
          running: (row?.withoutIncident ?? 0) + withIncident,
          withIncident,
        }
      })
  }

  private newestOf(definitions: readonly DefinitionView[]): Map<string, DefinitionView> {
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
