/**
 * The counts on a version's diagram (`getElementStatistics` of the engine contract): per element
 * the tokens waiting there, the incidents raised there and those copied up from a called
 * instance. A token held by an incident raised at its element counts as that incident, not as
 * active. Beside the contract's read, the same counts with each element's jobs without retries
 * (`withFailedJobs`), from the same one statistics read with `failedJobs`, for a surface that
 * shows both (the MCP server's process flow), so it reads a version's statistics once.
 */

import { ElementId, type DefinitionId, type ElementStatistics } from "@miragon/pulse-engine-core"
import type { EnginePort, Query } from "../port.js"
import { isRootIncident } from "../root-incident.js"
import { engineIdOf } from "./engine-ids.js"
import { type IncidentRow, incidentRowsOf } from "./incident-rows.js"
import { JsonView } from "./json-view.js"
import { readAll } from "./read-all.js"

interface ElementCounts {
  active: number
  incidents: number
  incidentsInCalledInstances: number
  failedJobs: number
}

/** An element's counts on a version's diagram with its jobs without retries (`withFailedJobs`). */
export interface ElementStatisticsWithFailedJobs extends ElementStatistics {
  /** The jobs at the element whose retries are used up. */
  readonly failedJobs: number
}

interface ActivityRow {
  readonly activityId: string
  readonly instances: number
  readonly failedJobs: number
}

/** The newest incident first, as the engine pages them. */
const NEWEST_FIRST = { sortBy: "incidentTimestamp", sortOrder: "desc" } as const

function activityRowsOf(answer: unknown): ActivityRow[] {
  return JsonView.listOf(answer, "activity statistics").map((row) => ({
    activityId: row.requiredString("id"),
    instances: row.requiredNumber("instances"),
    failedJobs: row.optionalNumber("failedJobs") ?? 0,
  }))
}

function countsFor(counts: Map<string, ElementCounts>, activityId: string): ElementCounts {
  const existing = counts.get(activityId)
  if (existing !== undefined) return existing
  const created = { active: 0, incidents: 0, incidentsInCalledInstances: 0, failedJobs: 0 }
  counts.set(activityId, created)
  return created
}

function countsOf(
  activities: readonly ActivityRow[],
  incidents: readonly IncidentRow[],
): Map<string, ElementCounts> {
  const counts = new Map<string, ElementCounts>()
  for (const element of activities) {
    const held = countsFor(counts, element.activityId)
    held.active = element.instances
    held.failedJobs = element.failedJobs
  }
  for (const incident of incidents) {
    const element = countsFor(counts, incident.activityId)
    if (isRootIncident(incident)) element.incidents += 1
    else element.incidentsInCalledInstances += 1
  }
  return counts
}

/** Reads the counts on a version's diagram over the engine's port. */
export class ElementStatisticsReader {
  constructor(private readonly port: EnginePort) {}

  /** The counts per element of the version `definitionId`; an id no engine assigns fails. */
  async of(definitionId: DefinitionId): Promise<ElementStatistics[]> {
    const counts = await this.read(definitionId, {})
    return counts.map(({ elementId, active, incidents, incidentsInCalledInstances }) => ({
      elementId,
      active,
      incidents,
      incidentsInCalledInstances,
    }))
  }

  /**
   * The counts per element of the version `definitionId` with each element's jobs without
   * retries, from one statistics read with `failedJobs`; an id no engine assigns fails.
   */
  withFailedJobs(definitionId: DefinitionId): Promise<ElementStatisticsWithFailedJobs[]> {
    return this.read(definitionId, { failedJobs: "true" })
  }

  private async read(
    definitionId: DefinitionId,
    statisticsQuery: Query,
  ): Promise<ElementStatisticsWithFailedJobs[]> {
    const id = engineIdOf(definitionId)
    const [activities, incidents] = await Promise.all([
      this.port
        .json("getActivityStatistics", { pathArgs: [id], query: statisticsQuery })
        .then(activityRowsOf),
      readAll(this.port, "getIncidents", { processDefinitionId: id, ...NEWEST_FIRST }).then(
        incidentRowsOf,
      ),
    ])
    return [...countsOf(activities, incidents).entries()].map(([activityId, counts]) => ({
      elementId: ElementId(activityId),
      active: Math.max(0, counts.active - counts.incidents),
      incidents: counts.incidents,
      incidentsInCalledInstances: counts.incidentsInCalledInstances,
      failedJobs: counts.failedJobs,
    }))
  }
}
