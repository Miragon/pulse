import type { DiagramDecoration } from "@miragon/pulse-ui/bpmn"
import type { ActivityStatisticsActivity, ActivityStatisticsData } from "../../view-models.js"
import type { ViewContext } from "../lib/hand-off.js"

/** How many elements the model context names: the ones with the most running. */
const MODEL_CONTEXT_TOP = 3

/**
 * In the one badge scheme, as the shared process screen draws it (owner decision 2026-11-24): each
 * element's counts apart over its top right corner, its open root incidents in red, the incidents
 * of the instances it called quiet in a badge of their own, its running instances in blue; only an
 * own root incident outlines it. A failed job that raised no incident yet has no badge: the values
 * per activity under the diagram name it.
 */
export function runningDecorations(
  activities: readonly ActivityStatisticsActivity[],
): DiagramDecoration[] {
  return activities.map((activity) => ({
    elementId: activity.activityId,
    counts: [
      { kind: "incidents", count: activity.incidents },
      { kind: "incidentsInCalledInstances", count: activity.incidentsInCalledInstances },
      { kind: "running", count: activity.running },
    ],
    incident: activity.incidents > 0,
  }))
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
      activitiesWithRootIncidents: data.activities.filter((a) => a.incidents > 0).length,
      activitiesWithIncidentsInCalledInstances: data.activities.filter(
        (a) => a.incidentsInCalledInstances > 0,
      ).length,
      ...topFacts,
    },
    untrusted: top.map((activity, index) => ({
      label: `top${index + 1}Name`,
      text: activity.activityName,
    })),
  }
}
