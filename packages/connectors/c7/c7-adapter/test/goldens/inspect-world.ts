import type { EngineAnswer, EngineReply } from "./loopback-engine.js"

const DEFINITION_ID = "order:2:6f1e8a"

const definition = { id: DEFINITION_ID, key: "order", name: "Order", version: 2 }

const ROUTES: Readonly<Record<string, EngineReply>> = {
  "/telemetry/data": { body: { product: { name: "CIB seven", version: "2.1.0" } } },
  "/version": { body: { version: "2.1.0" } },
  "/process-instance/pi-1": {
    body: {
      id: "pi-1",
      definitionId: DEFINITION_ID,
      definitionKey: "order",
      businessKey: "B-7",
      ended: false,
      suspended: false,
    },
  },
  "/history/process-instance/pi-1": {
    body: {
      id: "pi-1",
      businessKey: "B-7",
      processDefinitionId: DEFINITION_ID,
      processDefinitionKey: "order",
      processDefinitionName: "Order",
      processDefinitionVersion: 2,
      startTime: "2026-10-09T13:38:15.430+0000",
      endTime: null,
      rootProcessInstanceId: "pi-1",
      superProcessInstanceId: null,
      state: "ACTIVE",
    },
  },
  "/process-instance/pi-1/activity-instances": {
    body: {
      id: "pi-1",
      parentActivityInstanceId: null,
      activityId: DEFINITION_ID,
      activityType: "processDefinition",
      processInstanceId: "pi-1",
      processDefinitionId: DEFINITION_ID,
      executionIds: ["pi-1"],
      childActivityInstances: [],
      childTransitionInstances: [],
    },
  },
  "/process-definition": { body: [definition] },
  "/process-instance/pi-1/variables": { body: {} },
}

export const inspectWorld: EngineAnswer = (request) => {
  const path = new URL(request.target, "http://engine").pathname.replace(/^\/engine-rest/, "")
  if (request.method !== "GET") {
    return undefined
  }
  return ROUTES[path] ?? { body: [] }
}
