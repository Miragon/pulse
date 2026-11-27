/**
 * The processes of an engine (`listDefinitions`, `listVersions` and `getDiagramXml` of the engine
 * contract): every deployed version with its running instances, those with an open incident
 * ("with incident" by `with-incident.ts`) and its open root incidents, an exact statistic of the
 * one statistics read (`readDefinitionStatistics`); a process by its latest version with the sums
 * over all of them, as the one fold of the statistics per key gives them (`statisticsByKey`, which
 * the status triage and the MCP server's overview read too), processes in the order of their keys
 * (`localeCompare`, as the editors always read them). "With incident" counts per version what
 * the list shows (`withIncidentPerVersion`): the whole engine's for the processes, one process's
 * for its versions, from one page of those instances while it holds them all, else, by one count
 * of them, from the rest of their listing or from one count per version that runs an instance,
 * whichever sends fewer requests. The versions an incident names are read by their ids
 * (`refsOf`), never the statistics of the whole engine.
 */

import type {
  BpmnProcessId,
  DefinitionId,
  DefinitionRef,
  DefinitionSummary,
  VersionSummary,
} from "@miragon/pulse-engine-core"
import {
  type DefinitionStatisticsRow,
  readDefinitionStatistics,
  statisticsByKey,
} from "../definition-statistics.js"
import type { EnginePort } from "../port.js"
import { isEngineId } from "./engine-ids.js"
import { definitionRefOf } from "./definition-refs.js"
import { type DiagramRead, diagramReadOf, readDefinitionRows } from "./definition-rows.js"
import {
  type ProcessScope,
  type WithIncidentCounting,
  withIncidentPerVersion,
} from "./with-incident-per-version.js"

/** The versions with an open incident, counted by the version's id. */
type WithIncident = ReadonlyMap<string, number>

/** A version with its own counts. */
function versionOf(row: DefinitionStatisticsRow, withIncident: WithIncident): VersionSummary {
  return {
    definition: definitionRefOf(row.definition),
    running: row.instances,
    withIncident: withIncident.get(row.definition.id) ?? 0,
    incidents: row.rootIncidents,
  }
}

/** Each process by its latest version with the sums over its versions, in the order of the keys. */
function summariesOf(
  statistics: readonly DefinitionStatisticsRow[],
  withIncident: WithIncident,
): DefinitionSummary[] {
  return [...statisticsByKey(statistics).values()]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((process) => ({
      latest: definitionRefOf(process.latest),
      running: process.instances,
      withIncident: process.versions.reduce(
        (sum, row) => sum + (withIncident.get(row.definition.id) ?? 0),
        0,
      ),
      incidents: process.rootIncidents,
    }))
}

/** Reads the processes of an engine over its port. */
export class DefinitionReader {
  /**
   * `counting`: how a list counts "with incident" per version (`withIncidentPerVersion`), pages of
   * 500 and the path that sends fewer requests without it.
   */
  constructor(
    private readonly port: EnginePort,
    private readonly diagram: DiagramRead = diagramReadOf(port),
    private readonly counting: WithIncidentCounting = {},
  ) {}

  /** Every process by its latest version, with its instances and incidents over all versions. */
  async list(): Promise<DefinitionSummary[]> {
    const { statistics, withIncident } = await this.read({})
    return summariesOf(statistics, withIncident)
  }

  /** The versions of one process, newest first, each with its own instances and incidents. */
  async versions(bpmnProcessId: BpmnProcessId): Promise<VersionSummary[]> {
    const { statistics, withIncident } = await this.read({ processDefinitionKey: bpmnProcessId })
    return statistics
      .map((row) => versionOf(row, withIncident))
      .sort((left, right) => right.definition.version - left.definition.version)
  }

  /** The BPMN XML of a version; undefined for a version the engine does not know. */
  diagramXml(definitionId: DefinitionId): Promise<string | undefined> {
    return this.diagram(definitionId)
  }

  /**
   * The references to the versions `definitionIds` names, by their ids, read by those ids alone; a
   * version the engine does not list has none, and an id no engine assigns none without a request.
   */
  async refsOf(definitionIds: readonly string[]): Promise<ReadonlyMap<string, DefinitionRef>> {
    const ids = definitionIds.filter((id) => isEngineId(id))
    const rows = await readDefinitionRows(this.port, "processDefinitionIdIn", ids)
    return new Map(rows.map((row) => [row.id, definitionRefOf(row)]))
  }

  /** The statistics of the versions in `scope` (every version, or one key's) and their "with incident". */
  private async read(scope: ProcessScope) {
    const key = scope.processDefinitionKey
    const statistics = readDefinitionStatistics(this.port).then((rows) =>
      key === undefined ? rows : rows.filter((row) => row.definition.key === key),
    )
    const running = statistics.then((rows) =>
      rows.map((row) => ({ id: row.definition.id, instances: row.instances })),
    )
    const [rows, withIncident] = await Promise.all([
      statistics,
      withIncidentPerVersion(this.port, scope, running, this.counting),
    ])
    return { statistics: rows, withIncident }
  }
}
