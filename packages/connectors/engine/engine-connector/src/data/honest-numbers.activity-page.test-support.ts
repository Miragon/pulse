/**
 * The honest-numbers table's cases of an activity's page (`buildActivityIncidentsData`): read
 * whole, a first page totals its rows; with more, it totals the element as its group counts it, so
 * the key's scan is primary, and where the scan cannot hold the key so are the definition
 * statistics and the element counts of the versions they name, a version's diagram answered by its
 * whole read.
 */

import { buildActivityIncidentsData } from "./activity-incidents-data.js"
import { cibsevenProvider } from "../providers/index.js"
import { WORLD } from "../tools/test-support/engine-world.js"
import type { FakeReply, RecordedRequest } from "../tools/test-support/fake-engine.js"
import { INCIDENT_SCAN_LIMIT } from "./engine-reads.js"
import {
  type Case,
  incidentScan,
  LATEST_LOOKUP,
  V1_CALL_ACTIVITIES,
} from "./honest-numbers.test-support.js"

/** Two root incidents at the world's activity: a page of one has more. */
const TWO_ROOTS = incidentScan(2)

/**
 * The world with the two roots at its activity, none at its body, and `scanned` the key's scan;
 * any other read of the incidents (a version's whole read) the world's.
 */
function twoRootsAt(scanned: readonly unknown[]) {
  return (r: RecordedRequest): FakeReply | undefined => {
    if (r.path !== "/incident" || r.query.processDefinitionKeyIn === undefined) return undefined
    if (r.query.activityId === undefined) return { body: scanned }
    const rows = r.query.activityId === WORLD.activityId ? TWO_ROOTS : []
    const first = Number(r.query.firstResult ?? 0)
    return { body: rows.slice(first, first + Number(r.query.maxResults)) }
  }
}

/** The activity's first page, of `maxResults` rows. */
const firstPage =
  (maxResults?: number): Case["run"] =>
  (client, baseUrl) =>
    buildActivityIncidentsData(client, {
      baseUrl,
      provider: cibsevenProvider,
      processDefinitionKey: WORLD.key,
      activityId: WORLD.activityId,
      ...(maxResults === undefined ? {} : { maxResults }),
    })

const ENRICHMENT = {
  // The rows are named by their instances' business keys (#322 U13).
  "GET /process-instance?maxResults&processInstanceIds": (data: {
    incidents: Array<{ businessKey: unknown }>
  }) => data.incidents[0]?.businessKey,
  // The latest diagram names the element; unread, the rows and their total stay the same.
  [`GET /process-definition/${WORLD.latestDefinitionId}/xml`]: (data: {
    incidents: Array<{ activityName: unknown }>
  }) => data.incidents[0]?.activityName,
}

export const ACTIVITY_PAGE_CASES: Record<string, Case> = {
  buildActivityIncidentsData: {
    run: firstPage(),
    unknown: { read: LATEST_LOOKUP, reply: { body: [] } },
    enrichment: ENRICHMENT,
  },
  "buildActivityIncidentsData (more than a page)": {
    run: firstPage(1),
    world: twoRootsAt(TWO_ROOTS),
    enrichment: ENRICHMENT,
  },
  "buildActivityIncidentsData (more than a page, scan capped)": {
    run: firstPage(1),
    world: twoRootsAt(incidentScan(INCIDENT_SCAN_LIMIT)),
    enrichment: ENRICHMENT,
    fallback: V1_CALL_ACTIVITIES,
  },
}
