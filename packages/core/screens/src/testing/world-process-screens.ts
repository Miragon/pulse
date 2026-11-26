import type { InstanceListData } from "../format/instance-list-data.js"
import type { DefinitionRefData } from "../format/instance-screen-data.js"
import type { ProcessScreenData } from "../format/process-screen-data.js"

const AS_OF = "2026-11-19T09:00:00.000Z"
const ORDER_1: DefinitionRefData = {
  id: "pulse-order:1",
  bpmnProcessId: "pulse-order",
  version: 1,
  name: "Order fulfillment",
}
const ORDER_2: DefinitionRefData = { ...ORDER_1, id: "pulse-order:2", version: 2 }
const DISPATCH_1: DefinitionRefData = {
  id: "pulse-dispatch:1",
  bpmnProcessId: "pulse-dispatch",
  version: 1,
  name: "Dispatch order",
}
const ORDER_VERSIONS = [
  { definition: ORDER_2, running: 1, withIncident: 0 },
  { definition: ORDER_1, running: 2, withIncident: 1 },
]

export const WORLD_ORDER_SCREEN: ProcessScreenData = {
  engine: "conformance",
  asOf: AS_OF,
  bpmnProcessId: "pulse-order",
  selected: ORDER_2,
  versions: ORDER_VERSIONS,
  badges: [
    {
      elementId: "Activity_ReviewOrder",
      running: 1,
      incidents: 0,
      incidentsInCalledInstances: 0,
    },
  ],
  calls: [],
  notices: [{ code: "olderVersionsRun", running: 2, withIncident: 1, show: ORDER_1 }],
  unread: [],
}

export const WORLD_ORDER_V1_SCREEN: ProcessScreenData = {
  ...WORLD_ORDER_SCREEN,
  selected: ORDER_1,
  badges: [
    {
      elementId: "Activity_ReviewOrder",
      running: 1,
      incidents: 0,
      incidentsInCalledInstances: 0,
    },
    {
      elementId: "Activity_ChargePayment",
      running: 0,
      incidents: 1,
      incidentsInCalledInstances: 0,
    },
  ],
  notices: [],
}

export const WORLD_DISPATCH_PROCESS_SCREEN: ProcessScreenData = {
  engine: "conformance",
  asOf: AS_OF,
  bpmnProcessId: "pulse-dispatch",
  selected: DISPATCH_1,
  versions: [{ definition: DISPATCH_1, running: 1, withIncident: 1 }],
  badges: [
    {
      elementId: "Activity_PrintShippingLabel",
      running: 1,
      incidents: 0,
      incidentsInCalledInstances: 1,
    },
  ],
  calls: [
    {
      elementId: "Activity_PrintShippingLabel",
      kind: "definition",
      definition: {
        id: "pulse-label:1",
        bpmnProcessId: "pulse-label",
        version: 1,
        name: "Print label",
      },
    },
  ],
  notices: [],
  unread: [],
}

export const WORLD_ORDER_V1_LIST: InstanceListData = {
  engine: "conformance",
  asOf: AS_OF,
  definitionId: ORDER_1.id,
  rows: [
    {
      id: "fake-ORD-1001",
      state: "running",
      hasIncident: false,
      businessKey: "ORD-1001",
      startedAt: "2026-10-21T08:00:00.000Z",
    },
    {
      id: "fake-ORD-1002",
      state: "running",
      hasIncident: true,
      businessKey: "ORD-1002",
      startedAt: "2026-10-21T08:00:00.000Z",
    },
    {
      id: "fake-ORD-1003",
      state: "completed",
      hasIncident: false,
      businessKey: "ORD-1003",
      startedAt: "2026-10-21T08:00:00.000Z",
    },
  ],
  next: null,
  counts: { running: 2, withIncident: 1, ended: 1, all: 3 },
  refusedVariableConditions: [],
}
