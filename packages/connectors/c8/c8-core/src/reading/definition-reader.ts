import type {
  BpmnProcessId,
  DefinitionSummary,
  TenantId,
  VersionSummary,
} from "@miragon/pulse-engine-core"
import { DefinitionRefs } from "../mapping/definition-refs.js"
import { Tenants } from "../mapping/tenants.js"
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
      const process = DefinitionReader.processOf(row.bpmnProcessId, row.tenantId)
      const known = counts.get(process) ?? NO_INSTANCES
      counts.set(process, {
        running: known.running + row.withoutIncident + row.withIncident,
        withIncident: known.withIncident + row.withIncident,
      })
    }
    const newest = [...DefinitionReader.newestOf(latest).values()]
    const shared = DefinitionReader.keysInSeveralTenants(newest)
    return FewAtOnce.map(newest, async (definition) => {
      const process = DefinitionReader.processOf(definition.bpmnProcessId, definition.tenantId)
      const instances = counts.get(process) ?? NO_INSTANCES
      return {
        latest: DefinitionRefs.of(definition),
        ...instances,
        ...(await this.incidentsOf(
          DefinitionReader.processFilter(definition, shared),
          instances.withIncident,
        )),
      }
    })
  }

  async versions(
    bpmnProcessId: BpmnProcessId,
    tenantId: TenantId | null,
  ): Promise<VersionSummary[]> {
    const [definitions, statistics] = await Promise.all([
      this.client.versionsOf(bpmnProcessId),
      this.client.versionStatistics(bpmnProcessId),
    ])
    const rows = new Map(statistics.map((row) => [row.key, row]))
    const kept = definitions
      .filter(
        (definition) => definition.state !== DELETED && Tenants.same(definition.tenantId, tenantId),
      )
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

  private static processOf(bpmnProcessId: string, tenantId: string | undefined): string {
    return JSON.stringify([bpmnProcessId, Tenants.of(tenantId)])
  }

  private static processFilter(
    definition: DefinitionView,
    shared: ReadonlySet<string>,
  ): SearchFilter {
    const process = { processDefinitionId: definition.bpmnProcessId }
    return shared.has(definition.bpmnProcessId)
      ? { ...process, tenantId: Tenants.clusterIdOf(Tenants.of(definition.tenantId)) }
      : process
  }

  private static keysInSeveralTenants(definitions: readonly DefinitionView[]): Set<string> {
    const seen = new Set<string>()
    const shared = new Set<string>()
    for (const { bpmnProcessId } of definitions) {
      if (seen.has(bpmnProcessId)) shared.add(bpmnProcessId)
      seen.add(bpmnProcessId)
    }
    return shared
  }

  private static newestOf(definitions: readonly DefinitionView[]): Map<string, DefinitionView> {
    const newest = new Map<string, DefinitionView>()
    for (const definition of definitions) {
      const process = DefinitionReader.processOf(definition.bpmnProcessId, definition.tenantId)
      const known = newest.get(process)
      if (definition.state !== DELETED && (known?.version ?? 0) < definition.version) {
        newest.set(process, definition)
      }
    }
    return newest
  }
}
