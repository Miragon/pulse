/**
 * The processes of an engine (`listDefinitions`, `listVersions` and `getDiagramXml` of the engine
 * contract): every deployed version with its running instances, those with an open incident
 * ("with incident" by `with-incident.ts`) and its open root incidents, an exact statistic of the
 * same one statistics read (`readDefinitionStatistics`); a process by its latest version with the
 * sums over all of them, processes in the order of their keys (`localeCompare`, as the editors
 * always read them).
 */

import type {
  BpmnProcessId,
  DefinitionId,
  DefinitionRef,
  DefinitionSummary,
  VersionSummary,
} from "@miragon/pulse-engine-core"
import type { EnginePort } from "../port.js"
import { instancesWithIncident, withIncidentByVersion } from "../with-incident.js"
import { definitionRefOf } from "./definition-refs.js"
import { type DiagramRead, diagramReadOf, readDefinitionStatistics } from "./definition-rows.js"

/** A process by its latest version: the first of `versions` per key, newest first. */
function summariesOf(versions: readonly VersionSummary[]): DefinitionSummary[] {
  const byProcess = new Map<string, DefinitionSummary>()
  for (const version of versions) {
    const key = version.definition.bpmnProcessId
    const summary = byProcess.get(key)
    byProcess.set(
      key,
      summary === undefined
        ? {
            latest: version.definition,
            running: version.running,
            withIncident: version.withIncident,
            incidents: version.incidents,
          }
        : {
            latest: summary.latest,
            running: summary.running + version.running,
            withIncident: summary.withIncident + version.withIncident,
            incidents: summary.incidents + version.incidents,
          },
    )
  }
  return [...byProcess.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, summary]) => summary)
}

/** Reads the processes of an engine over its port. */
export class DefinitionReader {
  constructor(
    private readonly port: EnginePort,
    private readonly diagram: DiagramRead = diagramReadOf(port),
  ) {}

  /** Every process by its latest version, with its instances and incidents over all versions. */
  async list(): Promise<DefinitionSummary[]> {
    return summariesOf(await this.allVersions())
  }

  /** The versions of one process, newest first, each with its own instances and incidents. */
  async versions(bpmnProcessId: BpmnProcessId): Promise<VersionSummary[]> {
    const versions = await this.allVersions()
    return versions.filter((version) => version.definition.bpmnProcessId === bpmnProcessId)
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

  private async allVersions(): Promise<VersionSummary[]> {
    const [statistics, failing] = await Promise.all([
      readDefinitionStatistics(this.port),
      instancesWithIncident(this.port, {}),
    ])
    const withIncident = withIncidentByVersion(failing)
    return statistics
      .map((row) => ({
        definition: definitionRefOf(row.definition),
        running: row.instances,
        withIncident: withIncident.get(row.definition.id) ?? 0,
        incidents: row.rootIncidents,
      }))
      .sort((left, right) => right.definition.version - left.definition.version)
  }
}
