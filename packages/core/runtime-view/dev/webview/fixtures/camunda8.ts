import type {
  CallLink,
  DefinitionView,
  EngineBadge,
  InstanceRow,
  InstanceView,
} from "../../../src/core/protocol/index.js"
import orderXml from "./order-fulfillment.bpmn"
import { AS_OF, minutesBefore } from "./engines.js"

const C8_ENGINE: EngineBadge = {
  name: "shop-c8",
  environment: "test",
  host: "shop-c8.acme.internal",
  product: "Camunda 8 8.9.28",
  webUi: "Operate",
  access: {
    writable: false,
    note: "Read-only. Pulse reads this engine and changes no data on it.",
  },
}

const CREDIT_SCORING_MISSING: CallLink = {
  elementId: "Activity_CheckCredit",
  label: "credit-scoring isn't deployed on shop-c8, or you may not have permission to see it",
  missing: true,
}

function instance(key: string, startedMinutesAgo: number, hasIncident = false): InstanceRow {
  return {
    id: key,
    shortId: `…${key.slice(-8)}`,
    state: "Running",
    hasIncident,
    startedAt: minutesBefore(startedMinutesAgo),
  }
}

export const C8_DEFINITION_VIEW: DefinitionView = {
  kind: "definition",
  engine: C8_ENGINE,
  asOf: AS_OF,
  processName: "Order fulfillment",
  bpmnProcessId: "order-fulfillment",
  versions: [
    { definitionId: "2251799813685311", version: 3, running: 8412, withIncident: 37 },
    { definitionId: "2251799813685102", version: 2, running: 0, withIncident: 0 },
  ],
  selectedDefinitionId: "2251799813685311",
  selectedVersion: 3,
  diagramXml: orderXml,
  badges: [
    {
      elementId: "Activity_ReserveStock",
      running: 37,
      incidents: 37,
      incidentsInCalledInstances: 0,
    },
    {
      elementId: "Activity_ApproveOrder",
      running: 5120,
      incidents: 0,
      incidentsInCalledInstances: 0,
    },
    {
      elementId: "Event_WaitForPickup",
      running: 3255,
      incidents: 0,
      incidentsInCalledInstances: 0,
    },
  ],
  calls: [CREDIT_SCORING_MISSING],
  instances: [
    instance("2251799813690412", 18, true),
    instance("2251799813690398", 21),
    instance("2251799813690377", 26),
    instance("2251799813690351", 40),
    instance("2251799813690326", 55),
  ],
  hasMoreInstances: true,
  filter: { scope: "running" },
  variableNames: ["orderId", "amount", "express"],
  refusedVariableConditions: ["ordering", "date"],
  scopeCounts: {
    running: 10000,
    withIncident: 37,
    ended: 10000,
    all: 20000,
    atLeast: ["running", "ended", "all"],
  },
  notices: [],
  webUi: { label: "Open in Operate", title: "Open Order fulfillment v3 in Operate on shop-c8" },
}

export const C8_INSTANCE_VIEW: InstanceView = {
  kind: "instance",
  engine: C8_ENGINE,
  asOf: AS_OF,
  instance: {
    id: "2251799813690412",
    shortId: "…13690412",
    state: "Running",
    processName: "Order fulfillment",
    bpmnProcessId: "order-fulfillment",
    version: 3,
    definitionId: "2251799813685311",
    startedAt: minutesBefore(18),
  },
  diagramXml: orderXml,
  markers: [
    { elementId: "Activity_ReserveStock", kind: "incident" },
    { elementId: "Event_OrderReceived", kind: "completed" },
    { elementId: "Flow_1", kind: "taken" },
  ],
  calls: [CREDIT_SCORING_MISSING],
  incidents: [
    {
      id: "2251799813690467",
      shortId: "…13690467",
      elementId: "Activity_ReserveStock",
      typeLabel: "Job no retries",
      engineType: "JOB_NO_RETRIES",
      message: "Stock service answered 503: warehouse EU-2 is offline",
      rootCause: "Stock service answered 503: warehouse EU-2 is offline",
      causeLabel: "Worker error",
      createdAt: minutesBefore(17),
      retriesLeft: 0,
      detailsLabel: "Error message",
      job: { id: "2251799813690455", shortId: "…13690455", type: "reserve-stock" },
    },
  ],
  waitStates: [
    {
      elementId: "Activity_ReserveStock",
      elementName: "Reserve stock",
      kindLabel: "Worker task",
      detail: "Task type reserve-stock",
      taskType: "reserve-stock",
      since: minutesBefore(18),
    },
  ],
  path: [
    {
      elementId: "Event_OrderReceived",
      elementName: "Order received",
      startedAt: minutesBefore(18),
      endedAt: minutesBefore(18),
      duration: "12ms",
      durationMs: 12,
      state: "completed",
    },
    {
      elementId: "Activity_ReserveStock",
      elementName: "Reserve stock",
      startedAt: minutesBefore(18),
      state: "active",
    },
  ],
  variables: [
    { name: "orderId", valueJson: '"ORD-20731"', truncated: false },
    { name: "amount", valueJson: "312.9", truncated: false },
    { name: "express", valueJson: "true", truncated: false },
  ],
  truncated: true,
  webUi: { label: "Open in Operate", title: "Open …13690412 in Operate on shop-c8" },
}
