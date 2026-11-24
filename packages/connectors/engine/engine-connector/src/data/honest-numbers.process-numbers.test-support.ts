/**
 * The honest-numbers table's cases of a process's numbers (#665, `engine_process_stats` and
 * `engine_activity_counts`): every count and every rank of the stats is a figure, and so are the
 * diagrams that name the end events its series run over; per activity the element counts and the
 * open tasks are figures, while the diagram names and places the elements, and the newest
 * incidents and their root incidents word the latest of each.
 */

import { WORLD } from "../tools/test-support/engine-world.js"
import { buildActivityCountsData } from "./activity-counts-data.js"
import { type Case, V1_CALL_ACTIVITIES } from "./honest-numbers.test-support.js"
import { buildProcessStatsData } from "./process-stats-data.js"

/** Every version of a key, newest first (`fetchDefinitionVersions`): none is an unknown key. */
const UNKNOWN_KEY = {
  read: "GET /process-definition?key&sortBy&sortOrder",
  reply: { body: [] },
}

export const PROCESS_NUMBER_CASES: Record<string, Case> = {
  buildProcessStatsData: {
    run: (client) =>
      buildProcessStatsData(client, "fake", { processDefinitionKey: WORLD.key, bucket: "day" }),
    unknown: UNKNOWN_KEY,
  },
  buildActivityCountsData: {
    run: (client) => buildActivityCountsData(client, "fake", { processDefinitionKey: WORLD.key }),
    unknown: UNKNOWN_KEY,
    enrichment: {
      [`GET /process-definition/${WORLD.latestDefinitionId}/xml`]: (data: {
        activities: Array<{ inDiagram: unknown }>
      }) => data.activities[0]?.inDiagram,
      "GET /incident?maxResults&processDefinitionKeyIn&sortBy&sortOrder": (data: {
        activities: Array<{ latestIncident: unknown }>
      }) => data.activities[0]?.latestIncident,
      [`GET /incident/${WORLD.incidentId}`]: (data: {
        activities: Array<{ latestIncidentInCalledInstances: { message: unknown } | null }>
      }) => data.activities[1]?.latestIncidentInCalledInstances?.message,
    },
    fallback: V1_CALL_ACTIVITIES,
  },
}
