import type { DefinitionView, InstanceRow } from "../../../src/core/protocol/index.js"
import orderXml from "./order-fulfillment.bpmn"
import { AS_OF, LOCAL_ENGINE, minutesBefore } from "./engines.js"

function instance(
  id: string,
  businessKey: string,
  startedMinutesAgo: number,
  overrides: Partial<Pick<InstanceRow, "state" | "hasIncident">> = {},
): InstanceRow {
  return {
    id,
    shortId: `${id.slice(0, 8)}…`,
    businessKey,
    state: "Running",
    hasIncident: false,
    startedAt: minutesBefore(startedMinutesAgo),
    ...overrides,
  }
}

export const INSTANCES: readonly InstanceRow[] = [
  instance("8f3c2a1e-4b7d-4c1a-9f0e-1d2c3b4a5e6f", "ORD-10442", 150, { hasIncident: true }),
  instance("b71d09c4-2e8f-4a6b-8c3d-7e6f5a4b3c2d", "ORD-10440", 154, {
    state: "Suspended",
    hasIncident: true,
  }),
  instance("1a2b3c4d-5e6f-4a1b-9c8d-0e1f2a3b4c5d", "ORD-10438", 162),
  instance("77e0f1b2-9a8b-4c7d-8e6f-5a4b3c2d1e0f", "ORD-10431", 200),
  instance("c90e11aa-3b2c-4d1e-8f7a-6b5c4d3e2f1a", "ORD-10427", 260),
  instance("4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a", "ORD-10419", 1500),
  instance("e2f3a4b5-c6d7-4e8f-9a0b-1c2d3e4f5a6b", "ORD-10402", 2900),
]

export const DEFINITION_VIEW: DefinitionView = {
  kind: "definition",
  engine: LOCAL_ENGINE,
  asOf: AS_OF,
  processName: "Order fulfillment",
  bpmnProcessId: "order-fulfillment",
  versions: [
    { definitionId: "order-fulfillment:7:4a1c", version: 7, running: 12, withIncident: 2 },
    { definitionId: "order-fulfillment:6:91e0", version: 6, running: 3, withIncident: 1 },
    { definitionId: "order-fulfillment:5:0b7d", version: 5, running: 0, withIncident: 0 },
  ],
  selectedDefinitionId: "order-fulfillment:7:4a1c",
  selectedVersion: 7,
  diagramXml: orderXml,
  badges: [
    { elementId: "Activity_ReserveStock", running: 1, incidents: 0, incidentsInCalledInstances: 0 },
    { elementId: "Activity_CheckCredit", running: 5, incidents: 0, incidentsInCalledInstances: 2 },
    { elementId: "Activity_ApproveOrder", running: 3, incidents: 0, incidentsInCalledInstances: 0 },
    { elementId: "Event_WaitForPickup", running: 1, incidents: 0, incidentsInCalledInstances: 0 },
    { elementId: "Event_PaymentReceived", running: 1, incidents: 0, incidentsInCalledInstances: 0 },
    { elementId: "Activity_ShipOrder", running: 1, incidents: 1, incidentsInCalledInstances: 0 },
  ],
  calls: [{ elementId: "Activity_CheckCredit", label: "Open called process Credit scoring" }],
  instances: INSTANCES,
  hasMoreInstances: true,
  filter: { scope: "running" },
  scopeCounts: { running: 12, withIncident: 2, ended: 12437, all: 12449 },
  notices: [
    {
      tone: "info",
      title: "3 instances still run on v6.",
      actions: [
        { kind: "selectVersion", label: "Show v6", definitionId: "order-fulfillment:6:91e0" },
      ],
    },
  ],
}

export const FILTERED_DEFINITION_VIEW: DefinitionView = {
  ...DEFINITION_VIEW,
  instances: INSTANCES.slice(0, 2),
  hasMoreInstances: false,
  filter: { scope: "withIncident", elementId: "Activity_CheckCredit" },
  scopeCounts: { running: 5, withIncident: 2, ended: 0, all: 5 },
  notices: [],
}

export const ENDED_DEFINITION_VIEW: DefinitionView = {
  ...DEFINITION_VIEW,
  instances: [
    instance("d1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a", "ORD-10399", 3100, { state: "Completed" }),
    instance("a9b8c7d6-e5f4-4a3b-9c2d-1e0f9a8b7c6d", "ORD-10391", 3400, { state: "Terminated" }),
    instance("f0e1d2c3-b4a5-4968-8776-655443322110", "ORD-10388", 3600, { state: "Completed" }),
  ],
  hasMoreInstances: true,
  filter: { scope: "ended" },
  notices: [],
}
