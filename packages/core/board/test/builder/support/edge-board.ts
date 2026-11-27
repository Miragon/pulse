import {
  BpmnProcessId,
  DefinitionId,
  ElementId,
  IncidentId,
  InstanceId,
  IsoTimestamp,
} from "@miragon/pulse-engine-core"
import type { BoardModel } from "../../../src/builder/index.js"
import type {
  CounterWidget,
  IncidentListWidget,
  IncidentSummaryWidget,
  InstanceListWidget,
  ProcessDiagramWidget,
} from "../../../src/index.js"

export const INSTANCES: InstanceListWidget = {
  widget: "instanceList",
  engines: ["slow", "down"],
  filter: { state: "ended" },
  columns: ["businessKey"],
}
export const COUNTER: CounterWidget = { ...INSTANCES, widget: "counter", warnAbove: 5 }
export const SUMMARY: IncidentSummaryWidget = {
  widget: "incidentSummary",
  engines: [],
  groupBy: "engine",
}
export const DIAGRAM: ProcessDiagramWidget = {
  widget: "processDiagram",
  engines: [],
  process: "order",
}
export const INCIDENTS: IncidentListWidget = { widget: "incidentList", engines: ["slow"] }
const UNNAMED = {
  id: DefinitionId("order:3"),
  bpmnProcessId: BpmnProcessId("order"),
  tenantId: null,
  version: 3,
}
const FIELD_THE_MODEL_MAY_GAIN = { readAt: "2026-10-21T09:00:00Z" }

export const EDGES: BoardModel = {
  title: "Edges",
  engines: [{ name: "slow", state: "ready", info: { product: "Engine", version: "2.1.5" } }],
  rows: [
    [
      {
        kind: "counter",
        widget: COUNTER,
        readings: [
          { engine: "slow", count: { count: 10, atLeast: true }, undecided: true },
          { ...FIELD_THE_MODEL_MAY_GAIN, engine: "down" },
        ],
        known: 1,
        total: { count: 10, atLeast: true },
      },
      { kind: "counter", widget: COUNTER, readings: [{ engine: "down" }], known: 0 },
    ],
    [
      {
        kind: "instanceList",
        widget: INSTANCES,
        groups: [
          {
            engine: "slow",
            instances: [
              {
                id: InstanceId("sub-1"),
                definition: UNNAMED,
                state: "terminated",
                hasIncident: false,
                endedAt: IsoTimestamp("2026-10-21T09:00:00Z"),
                parentInstanceId: InstanceId("root-1"),
              },
            ],
          },
          { engine: "down" },
        ],
      },
      {
        kind: "incidentSummary",
        widget: SUMMARY,
        engines: 2,
        known: 0,
        rows: [{ engine: "slow" }],
      },
    ],
    [
      { kind: "processDiagram", widget: DIAGRAM, engine: "slow", notDeployed: true },
      { kind: "processDiagram", widget: DIAGRAM, engine: "down" },
      {
        kind: "incidentList",
        widget: INCIDENTS,
        groups: [
          {
            engine: "slow",
            incidents: [
              {
                id: IncidentId("incident-1"),
                instanceId: InstanceId("sub-1"),
                definition: UNNAMED,
                elementId: ElementId("Task_Pay"),
                type: "failedJob",
                message: "Payment failed",
                createdAt: IsoTimestamp("2026-10-21T08:30:00Z"),
                retriesLeft: 0,
                job: { id: "job-1", type: "payment" },
                details: { kind: "stacktrace", text: "at Pay", truncated: false },
              },
            ],
            more: true,
          },
          { engine: "down" },
        ],
      },
      {
        ...FIELD_THE_MODEL_MAY_GAIN,
        kind: "refused",
        problems: [{ path: "rows[2].row[3]", code: "notAnObject" }],
      },
    ],
  ],
}
