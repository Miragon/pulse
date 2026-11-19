import type { BoardStartData } from "../../view-models.board.js"

/** The board's time of reading, 08:00 UTC. */
const BOARD_AS_OF = "2026-10-26T08:00:00.000Z"

const INVOICE = {
  id: "invoice:3:7f1c2a9e",
  bpmnProcessId: "invoice",
  version: 3,
  name: "Invoice receipt",
} as const

/** The instance the list shows running with an incident, and the one it shows cancelled. */
export const RUNNING_INSTANCE = "81a2e0b4-3c1d-11ef-9a3e-0242ac120002"
export const ENDED_INSTANCE = "9b1c4d22-3c1d-11ef-9a3e-0242ac120002"

/**
 * A board over three engines, `prod-a` that answered, `down` that failed and `nowhere` that no
 * profile carries, with one tile of each kind and one the file breaks.
 */
export const BOARD: BoardStartData = {
  title: "Invoices",
  asOf: BOARD_AS_OF,
  engines: [
    {
      name: "prod-a",
      state: "ready",
      product: "CIB seven",
      version: "2.1.0",
      totals: { running: 12, withIncident: 2 },
    },
    {
      name: "down",
      state: "failed",
      failure: {
        code: "unreachable",
        message: "[503 ProcessEngineException] Engine is shutting down (engine down)",
      },
    },
    { name: "nowhere", state: "notConfigured" },
  ],
  rows: [
    [
      {
        kind: "counter",
        widget: {
          widget: "counter",
          title: "Waiting for approval",
          engines: ["prod-a", "down"],
          filter: { state: "running", process: "invoice", activeElement: "approve" },
        },
        readings: [{ engine: "prod-a", count: { count: 7 } }, { engine: "down" }],
        known: 1,
        total: { count: 7 },
      },
      {
        kind: "incidentSummary",
        widget: { widget: "incidentSummary", engines: ["prod-a", "down"], groupBy: "process" },
        engines: 2,
        known: 1,
        total: 2,
        rows: [{ engine: "prod-a", process: INVOICE, withIncident: 2 }],
      },
    ],
    [
      {
        kind: "instanceList",
        widget: {
          widget: "instanceList",
          engines: ["prod-a"],
          filter: { state: "running", process: "invoice" },
          columns: ["businessKey", "state", "incident"],
        },
        groups: [
          {
            engine: "prod-a",
            total: { count: 2 },
            instances: [
              {
                id: RUNNING_INSTANCE,
                definition: INVOICE,
                state: "running",
                hasIncident: true,
                businessKey: "INV-0042",
              },
              { id: ENDED_INSTANCE, definition: INVOICE, state: "terminated", hasIncident: false },
            ],
          },
        ],
      },
      {
        kind: "incidentList",
        widget: { widget: "incidentList", engines: ["prod-a"] },
        groups: [
          {
            engine: "prod-a",
            incidents: [
              {
                id: "inc-1",
                instanceId: RUNNING_INSTANCE,
                definition: INVOICE,
                elementId: "approve",
                type: "failedJob",
                message: "Approver lookup failed",
                createdAt: "2026-10-26T07:00:00.000Z",
              },
            ],
          },
        ],
      },
    ],
    [
      {
        kind: "processDiagram",
        widget: { widget: "processDiagram", engines: ["prod-a"], process: "invoice" },
        engine: "prod-a",
        latest: INVOICE,
        badges: [{ elementId: "approve", active: 7, incidents: 2, incidentsInCalledInstances: 1 }],
      },
      {
        kind: "refused",
        widget: "chart",
        problems: [
          {
            path: "rows[2].row[1].widget",
            code: "notOneOf",
            values: { choices: ["counter", "instanceList"] },
          },
        ],
      },
    ],
  ],
  notes: [{ path: "$schema", code: "schemaNotText" }],
}
