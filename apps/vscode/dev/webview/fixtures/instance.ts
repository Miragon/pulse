import type { CalledInstanceLink, InstanceView } from "../../../src/core/protocol/index.js"
import orderXml from "./order-fulfillment.bpmn"
import { AS_OF, LOCAL_ENGINE, minutesAfter, minutesBefore } from "./engines.js"

const SCORING: CalledInstanceLink = {
  instanceId: "3e9d1c2b-7a6f-4e5d-8c4b-2a1f0e9d8c7b",
  shortId: "3e9d1c2b…",
  bpmnProcessId: "credit-scoring",
}

const HEADER = {
  shortId: "8f3c2a1e…",
  businessKey: "ORD-10442",
  state: "Running",
  processName: "Order fulfillment",
  bpmnProcessId: "order-fulfillment",
  version: 7,
  definitionId: "order-fulfillment:7:4a1c",
  startedAt: minutesBefore(150),
} as const

export const INSTANCE_WITH_CALLED_INCIDENT: InstanceView = {
  kind: "instance",
  engine: LOCAL_ENGINE,
  asOf: AS_OF,
  instance: { id: "8f3c2a1e-4b7d-4c1a-9f0e-1d2c3b4a5e6f", ...HEADER },
  diagramXml: orderXml,
  markers: [
    { elementId: "Activity_CheckCredit", kind: "incidentInCalledInstance" },
    { elementId: "Event_OrderReceived", kind: "completed" },
    { elementId: "Activity_ReserveStock", kind: "completed" },
    { elementId: "Flow_1", kind: "taken" },
    { elementId: "Flow_2", kind: "taken" },
  ],
  path: [
    {
      elementId: "Event_OrderReceived",
      elementName: "Order received",
      startedAt: minutesBefore(150),
      endedAt: minutesBefore(150),
      duration: "4 ms",
      state: "completed",
    },
    {
      elementId: "Activity_ReserveStock",
      elementName: "Reserve stock",
      startedAt: minutesBefore(150),
      endedAt: minutesBefore(149),
      duration: "1 min 2 s",
      state: "completed",
    },
    {
      elementId: "Activity_CheckCredit",
      elementName: "Check credit",
      startedAt: minutesBefore(149),
      state: "active",
    },
  ],
  calls: [
    {
      elementId: "Activity_CheckCredit",
      label: `Open called instance ${SCORING.bpmnProcessId} ${SCORING.shortId}`,
    },
  ],
  incidents: [
    {
      id: "a4b5c6d7-e8f9-4a0b-9c1d-2e3f4a5b6c7d",
      shortId: "a4b5c6d7…",
      elementId: "Activity_CallScoringApi",
      typeLabel: "Failed job",
      engineType: "failedJob",
      message: 'I/O error on POST "https://scoring.internal/score": Connection refused',
      rootCause: "ConnectException: Connection refused",
      createdAt: minutesBefore(148),
      retriesLeft: 0,
      detailsLabel: "Open stacktrace",
      inCalledInstance: SCORING,
      job: {
        id: "5c1d77a0-9e8f-4d7c-b6a5-4f3e2d1c0b9a",
        shortId: "5c1d77a0…",
        type: "scoring-api",
      },
      model: {
        fileName: "credit-scoring.bpmn",
        settings: [
          { label: "Delegate", value: "${scoringApiClient}" },
          { label: "Input", value: "applicant ← ${customer}" },
          { label: "Error", value: "SCORING_UNAVAILABLE" },
        ],
        codeLabel: "ScoringApiClient.java",
      },
    },
  ],
  waitStates: [
    {
      elementId: "Activity_CallScoringApi",
      elementName: "Call scoring API",
      kindLabel: "Async continuation",
      detail: "job 5c1d77a0… · 0 retries left",
      since: minutesBefore(148),
      calledInstance: SCORING,
    },
  ],
  variables: [
    { name: "orderId", type: "String", valueJson: '"ORD-10442"', truncated: false },
    { name: "amount", type: "Double", valueJson: "1240.5", truncated: false },
    {
      name: "customer",
      type: "Json",
      valueJson:
        '{"id":"C-77","tier":"gold","address":{"city":"Munich","zip":"80331"},"tags":["b2b","priority"]}',
      truncated: false,
    },
    {
      name: "scoringResult",
      type: "Null",
      valueJson: "null",
      scopeElementId: "Activity_CheckCredit",
      truncated: false,
    },
    {
      name: "items",
      type: "Json",
      valueJson: '[{"sku":"A-100","qty":2},{"sku":"B-220","qty":1},{"sku":"C-310"',
      truncated: true,
    },
    { name: "express", type: "Boolean", valueJson: "false", truncated: false },
  ],
  truncated: false,
}

export const INSTANCE_WAITING: InstanceView = {
  kind: "instance",
  engine: LOCAL_ENGINE,
  asOf: AS_OF,
  diagramXml: orderXml,
  variables: INSTANCE_WITH_CALLED_INCIDENT.variables,
  truncated: false,
  instance: {
    ...INSTANCE_WITH_CALLED_INCIDENT.instance,
    id: "1a2b3c4d-5e6f-4a1b-9c8d-0e1f2a3b4c5d",
    shortId: "1a2b3c4d…",
    businessKey: "ORD-10438",
  },
  markers: [{ elementId: "Activity_ApproveOrder", kind: "waiting" }],
  calls: [],
  incidents: [],
  path: [],
  waitStates: [
    {
      elementId: "Activity_ApproveOrder",
      kindLabel: "User task",
      detail: "assignee mia",
      since: minutesBefore(82),
      dueAt: minutesAfter(28),
    },
  ],
}
