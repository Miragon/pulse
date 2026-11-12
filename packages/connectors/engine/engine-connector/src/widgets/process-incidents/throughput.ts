import type { ActivityThroughputActivity, ActivityThroughputData } from "../../view-models.js"
import type { ViewContext } from "../lib/hand-off.js"

/**
 * The query root of "Throughput": outside the cockpit's Refresh (`engine:`), since the read loads
 * the engine's database. It runs when the operator picks the mode or retries, never on its own.
 */
export const THROUGHPUT_QUERY_ROOT = "engine-history:activity-throughput"

/** How many elements the model context names: the ones passed most. */
const MODEL_CONTEXT_TOP = 3

/**
 * The heat per element the latest diagram draws: what the window's instances passed there. An
 * element they only reach so far (still running there) has no pass yet and stays unpainted.
 */
export function passesByElement(
  activities: readonly ActivityThroughputActivity[],
): Record<string, number> {
  return Object.fromEntries(
    activities
      .filter((a) => a.inDiagram !== false && a.passed > 0)
      .map((a) => [a.activityId, a.passed]),
  )
}

/** What the model reads off the throughput view: typed counts and ids, the element names fenced. */
export function describeThroughputFlow(data: ActivityThroughputData): ViewContext {
  const top = data.activities.slice(0, MODEL_CONTEXT_TOP)
  const topFacts: Record<string, string | number> = {}
  top.forEach((activity, index) => {
    topFacts[`top${index + 1}ActivityId`] = activity.activityId
    topFacts[`top${index + 1}Passed`] = activity.passed
    topFacts[`top${index + 1}Running`] = activity.running
  })
  return {
    summary:
      "The operator is viewing what a process's instances started in the window passed at each activity, on the latest version's diagram.",
    ids: {
      engine: data.engineId,
      processDefinitionKey: data.processDefinitionKey,
      diagramDefinitionId: data.diagramDefinitionId,
    },
    facts: {
      startedAfter: data.startedAfter,
      windowDays: data.windowDays,
      windowCutByHistoryTimeToLive: data.cappedByHistoryTimeToLive,
      instancesStarted: data.instanceCount,
      instancesNotCounted: data.uncountedInstances,
      versionsRead: data.versionsRead,
      diagramVersion: data.diagramVersion,
      historyRecorded: data.historyRecorded,
      readAt: data.readAt,
      ...topFacts,
    },
    untrusted: top.map((activity, index) => ({
      label: `top${index + 1}Name`,
      text: activity.activityName,
    })),
  }
}
