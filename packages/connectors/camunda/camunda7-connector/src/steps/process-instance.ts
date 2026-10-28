import { buildInstanceDetailData } from "../data/instance-detail-data.js"
import { adapterStep, requiredKey } from "./shared.js"

export const loadProcessInstanceStep = adapterStep({
  name: "load-process-instance",
  description:
    "One running process instance: state, activity tree, variables, open incidents and user tasks, BPMN. Powers camunda7:instance-detail.",
  dataType: "camunda7:processInstance",
  requires: ["camunda7:processInstanceId"],
  read: (context, { client, engineId, ...urls }) =>
    buildInstanceDetailData(
      client,
      engineId,
      { processInstanceId: requiredKey(context, "camunda7:processInstanceId") },
      urls,
    ),
  produces: {
    "camunda7:instance": (data) => data.instance,
    "camunda7:activityTree": (data) => data.activityTree,
    "camunda7:variables": (data) => data.variables,
    "camunda7:incidents": (data) => data.incidents,
  },
})
