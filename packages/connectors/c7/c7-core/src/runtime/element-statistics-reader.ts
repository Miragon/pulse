/**
 * The counts on a version's diagram (`getElementStatistics` of the engine contract): per element
 * the tokens waiting there, the incidents raised there and those copied up from a called
 * instance. A token held by an incident raised at its element counts as that incident, not as
 * active.
 */

import { ElementId, type DefinitionId, type ElementStatistics } from "@miragon/pulse-engine-core"
import type { EnginePort } from "../port.js"
import { isRootIncident } from "../root-incident.js"
import { engineIdOf } from "./engine-ids.js"
import { type IncidentRow, incidentRowsOf } from "./incident-rows.js"
import { JsonView } from "./json-view.js"
import { readAll } from "./read-all.js"

interface ElementCounts {
  active: number
  incidents: number
  incidentsInCalledInstances: number
}

interface ActivityRow {
  readonly activityId: string
  readonly instances: number
}

/** The newest incident first, as the engine pages them. */
const NEWEST_FIRST = { sortBy: "incidentTimestamp", sortOrder: "desc" } as const

function activityRowsOf(answer: unknown): ActivityRow[] {
  return JsonView.listOf(answer, "activity statistics").map((row) => ({
    activityId: row.requiredString("id"),
    instances: row.requiredNumber("instances"),
  }))
}

function countsFor(counts: Map<string, ElementCounts>, activityId: string): ElementCounts {
  const existing = counts.get(activityId)
  if (existing !== undefined) return existing
  const created = { active: 0, incidents: 0, incidentsInCalledInstances: 0 }
  counts.set(activityId, created)
  return created
}

function countsOf(
  activities: readonly ActivityRow[],
  incidents: readonly IncidentRow[],
): Map<string, ElementCounts> {
  const counts = new Map<string, ElementCounts>()
  for (const element of activities) {
    countsFor(counts, element.activityId).active = element.instances
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
    const id = engineIdOf(definitionId)
    const [activities, incidents] = await Promise.all([
      this.port.json("getActivityStatistics", { pathArgs: [id], query: {} }).then(activityRowsOf),
      readAll(this.port, "getIncidents", { processDefinitionId: id, ...NEWEST_FIRST }).then(
        incidentRowsOf,
      ),
    ])
    return [...countsOf(activities, incidents).entries()].map(([activityId, counts]) => ({
      elementId: ElementId(activityId),
      active: Math.max(0, counts.active - counts.incidents),
      incidents: counts.incidents,
      incidentsInCalledInstances: counts.incidentsInCalledInstances,
    }))
  }
}
