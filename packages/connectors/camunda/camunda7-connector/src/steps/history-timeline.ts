import { buildHistoryTimelineData } from "../data/history-timeline-data.js"
import { adapterStep, requiredKey } from "./shared.js"

export const loadHistoryTimelineStep = adapterStep({
  name: "load-history-timeline",
  description:
    "The activity history of one process instance (first page, exact total; the widget pages the rest). Powers camunda7:history-timeline.",
  dataType: "camunda7:historyTimeline",
  requires: ["camunda7:processInstanceId"],
  read: (context, { client, engineId }) =>
    buildHistoryTimelineData(client, engineId, {
      processInstanceId: requiredKey(context, "camunda7:processInstanceId"),
    }),
  produces: {
    "camunda7:historyProcessInstance": (data) => data.processInstance,
    "camunda7:historyActivities": (data) => data.activities,
  },
})
