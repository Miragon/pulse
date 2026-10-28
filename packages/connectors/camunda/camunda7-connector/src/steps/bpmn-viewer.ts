import { buildBpmnViewerData } from "../data/bpmn-viewer-data.js"
import { adapterStep, requiredKey } from "./shared.js"

export const loadBpmnViewerStep = adapterStep({
  name: "load-bpmn-viewer",
  description:
    "A running instance's BPMN diagram with its own active activities, incidents and failed jobs. Powers camunda7:bpmn-viewer-header, camunda7:bpmn-viewer-legend and camunda7:bpmn-flow-viewer.",
  dataType: "camunda7:bpmnViewer",
  requires: ["camunda7:processInstanceId"],
  read: async (context, { client, engineId }) => {
    const processInstanceId = requiredKey(context, "camunda7:processInstanceId")
    const data = await buildBpmnViewerData(client, engineId, { processInstanceId })
    // A failure, never a success-shaped empty diagram.
    if (!data.processDefinitionId) {
      throw new Error(`Process instance ${processInstanceId} names no process definition.`)
    }
    return data
  },
  produces: { "camunda7:bpmnViewerData": (data) => data },
})
