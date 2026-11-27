/**
 * The processes of an engine (`listDefinitions`, `listVersions` and `getDiagramXml` of the engine
 * contract): every deployed version with its running instances, those with an open incident
 * ("with incident" by `with-incident.ts`) and its open root incidents, an exact statistic of the
 * one statistics read (`readDefinitionStatistics`); a process by its latest version with the sums
 * over all of them, as the one fold of the statistics per key gives them (`statisticsByKey`, which
 * the status triage and the MCP server's overview read too), processes in the order of their keys
 * (`localeCompare`, as the editors always read them).
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
import { instancesWithIncident, withIncidentByVersion } from "../with-incident.js"
import { definitionRefOf } from "./definition-refs.js"
import { type DiagramRead, diagramReadOf } from "./definition-rows.js"

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
  constructor(
    private readonly port: EnginePort,
    private readonly diagram: DiagramRead = diagramReadOf(port),
  ) {}

  /** Every process by its latest version, with its instances and incidents over all versions. */
  async list(): Promise<DefinitionSummary[]> {
    const { statistics, withIncident } = await this.read()
    return summariesOf(statistics, withIncident)
  }

  /** The versions of one process, newest first, each with its own instances and incidents. */
  async versions(bpmnProcessId: BpmnProcessId): Promise<VersionSummary[]> {
    const { statistics, withIncident } = await this.read()
    return statistics
      .filter((row) => row.definition.key === bpmnProcessId)
      .map((row) => versionOf(row, withIncident))
      .sort((left, right) => right.definition.version - left.definition.version)
  }

  /** The BPMN XML of a version; undefined for a version the engine does not know. */
  diagramXml(definitionId: DefinitionId): Promise<string | undefined> {
    return this.diagram(definitionId)
  }

  /** The reference to every deployed version, by its id. */
  async refsById(): Promise<ReadonlyMap<string, DefinitionRef>> {
    const statistics = await readDefinitionStatistics(this.port)
    return new Map(statistics.map((row) => [row.definition.id, definitionRefOf(row.definition)]))
  }

  private async read() {
    const [statistics, failing] = await Promise.all([
      readDefinitionStatistics(this.port),
      instancesWithIncident(this.port, {}),
    ])
    return { statistics, withIncident: withIncidentByVersion(failing) }
  }
}
