/**
 * The honest-numbers table's cases of the overview (`buildEngineHealthData`, and the cockpit's
 * start on it): the verdict's inputs are primary, while the day's started and completed instances,
 * whether the engine writes history at all and the names that title the clusters are enrichment.
 */

import { DEFAULT_VERDICT_THRESHOLDS } from "@miragon/pulse-c7-core"
import { cibsevenProvider } from "../providers/index.js"
import { WORLD } from "../tools/test-support/engine-world.js"
import { buildCockpitStart } from "./cockpit-start.js"
import { buildEngineHealthData } from "./health-data.js"
import type { Case } from "./honest-numbers.test-support.js"

interface Summary {
  summary: { started24h: unknown; completed24h: unknown; historyRecorded: unknown }
}

/** The diagram that names the clusters' activity (`fetchNamesByDefinition`). */
const NAMES = `GET /process-definition/${WORLD.instanceDefinitionId}/xml`
const STARTED = "GET /history/process-instance/count?startedAfter"
const COMPLETED = "GET /history/process-instance/count?finishedAfter"

const health: Case["run"] = (client) => buildEngineHealthData(client, "fake")

export const HEALTH_CASES: Record<string, Case> = {
  buildEngineHealthData: {
    run: health,
    enrichment: {
      [STARTED]: (data: Summary) => data.summary.started24h,
      [COMPLETED]: (data: Summary) => data.summary.completed24h,
      // The clusters are titled by their activity's name (#322 U12).
      [NAMES]: (data: { clusters: Array<{ activityName: unknown }> }) =>
        data.clusters[0]?.activityName,
    },
  },
  // The day's history counts nothing: whether the engine writes history at all is enrichment.
  "buildEngineHealthData (history, nothing counted)": {
    run: health,
    world: (r) =>
      r.path === "/history/process-instance/count" ? { body: { count: 0 } } : undefined,
    enrichment: {
      [STARTED]: (data: Summary) => data.summary.started24h,
      [COMPLETED]: (data: Summary) => data.summary.completed24h,
      "GET /process-instance?maxResults": (data: Summary) => data.summary.historyRecorded,
      "GET /history/process-instance?maxResults&unfinished": (data: Summary) =>
        data.summary.historyRecorded,
      [NAMES]: (data: { clusters: Array<{ activityName: unknown }> }) =>
        data.clusters[0]?.activityName,
    },
  },
  // The cockpit's start view: the overview reads the health verdict and the definitions table.
  "buildCockpitStart (overview)": {
    run: (client, baseUrl) =>
      buildCockpitStart(
        { section: "overview" },
        { client, engineId: "fake", baseUrl, provider: cibsevenProvider },
        DEFAULT_VERDICT_THRESHOLDS,
      ),
    enrichment: {
      [STARTED]: (data: { data: { health: Summary } }) => data.data.health.summary.started24h,
      [COMPLETED]: (data: { data: { health: Summary } }) => data.data.health.summary.completed24h,
      [NAMES]: (data: { data: { health: { clusters: Array<{ activityName: unknown }> } } }) =>
        data.data.health.clusters[0]?.activityName,
    },
  },
}
