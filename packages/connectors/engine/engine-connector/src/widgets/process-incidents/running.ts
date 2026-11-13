import type { ActivityStatisticsActivity, ActivityStatisticsData } from "../../view-models.js"
import type { BpmnHighlight } from "../bpmn-highlights.js"
import type { ViewContext } from "../lib/hand-off.js"

/** How many elements the model context names: the ones with the most running. */
const MODEL_CONTEXT_TOP = 3

const countsOf = (
  activities: readonly ActivityStatisticsActivity[],
  of: (activity: ActivityStatisticsActivity) => number,
) =>
  activities
    .filter((activity) => of(activity) > 0)
    .map((activity) => ({ activityId: activity.activityId, count: of(activity) }))

/**
 * As the engine's own cockpit draws it: the running count on each element in blue, its open
 * incidents in red. A failed job that raised no incident still shows its count in red; one with an
 * incident shows the incident, since both badges take the same corner.
 */
export function runningHighlights(
  activities: readonly ActivityStatisticsActivity[],
): BpmnHighlight[] {
  const running = countsOf(activities, (a) => a.running)
  const incidents = countsOf(activities, (a) => a.incidents)
  return [
    { kind: "active", activityIds: running.map((c) => c.activityId) },
    { kind: "instance-count", counts: running },
    { kind: "incident", activityIds: incidents.map((c) => c.activityId), counts: incidents },
    {
      kind: "failed-jobs",
      counts: countsOf(activities, (a) => (a.incidents > 0 ? 0 : a.failedJobs)),
    },
  ]
}

/** What the model reads off the running view: typed counts and ids, the element names fenced. */
export function describeRunningFlow(data: ActivityStatisticsData): ViewContext {
  const top = data.activities.filter((a) => a.running > 0).slice(0, MODEL_CONTEXT_TOP)
  const topFacts: Record<string, string | number> = {}
  top.forEach((activity, index) => {
    topFacts[`top${index + 1}ActivityId`] = activity.activityId
    topFacts[`top${index + 1}Running`] = activity.running
  })
  return {
    summary:
      "The operator is viewing what runs at each activity of a process right now, summed over every deployed version, on the latest version's diagram.",
    ids: {
      engine: data.engineId,
      processDefinitionKey: data.processDefinitionKey,
      diagramDefinitionId: data.diagramDefinitionId,
    },
    facts: {
      versions: data.versionCount,
      diagramVersion: data.diagramVersion,
      activitiesRunning: data.activities.filter((a) => a.running > 0).length,
      activitiesWithIncidents: data.activities.filter((a) => a.incidents > 0).length,
      ...topFacts,
    },
    untrusted: top.map((activity, index) => ({
      label: `top${index + 1}Name`,
      text: activity.activityName,
    })),
  }
}
