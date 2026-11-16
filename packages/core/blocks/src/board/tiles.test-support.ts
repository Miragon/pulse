import type {
  CounterData,
  IncidentListData,
  IncidentSummaryData,
  InstanceListData,
  ProcessDiagramData,
  RefusedData,
  TileData,
} from "@miragon/pulse-board"

export const ORDER = {
  id: "order:3",
  bpmnProcessId: "order",
  version: 3,
  name: "Order fulfillment",
} as const

const SHIPMENT = { id: "shipment:2", bpmnProcessId: "shipment", version: 2 } as const

export const COUNTER: CounterData = {
  kind: "counter",
  widget: {
    widget: "counter",
    title: "Waiting for payment",
    engines: ["local", "test", "prod"],
    filter: { state: "running", process: "order", activeElement: "Task_Pay", businessKey: "B-1" },
    warnAbove: 5,
  },
  readings: [
    { engine: "local", count: { count: 10 }, above: true },
    { engine: "test", count: { count: 2 } },
    { engine: "prod" },
  ],
  known: 2,
  total: { count: 12 },
}

export const SUMMARY: IncidentSummaryData = {
  kind: "incidentSummary",
  widget: { widget: "incidentSummary", engines: ["local", "test"], groupBy: "process" },
  engines: 2,
  known: 1,
  total: 3,
  rows: [
    { engine: "local", process: ORDER, withIncident: 3 },
    { engine: "test", process: SHIPMENT },
  ],
}

export const INSTANCES: InstanceListData = {
  kind: "instanceList",
  widget: {
    widget: "instanceList",
    title: "Orders",
    engines: ["local", "test", "prod"],
    filter: { state: "running" },
    columns: ["businessKey", "process", "version", "state", "startedAt", "endedAt", "incident"],
  },
  groups: [
    {
      engine: "local",
      total: { count: 10000, atLeast: true },
      instances: [
        {
          id: "81a2e0b4-3c1d-11ef-9a3e-0242ac120002",
          definition: ORDER,
          state: "running",
          hasIncident: true,
          startedAt: "2026-10-26T08:00:00.000Z",
        },
        {
          id: "9b1c4d22-3c1d-11ef-9a3e-0242ac120002",
          definition: SHIPMENT,
          state: "terminated",
          hasIncident: false,
          businessKey: "B-7",
          endedAt: "2026-10-26T09:00:00.000Z",
        },
      ],
    },
    { engine: "test", instances: [] },
    { engine: "prod" },
  ],
}

export const INCIDENTS: IncidentListData = {
  kind: "incidentList",
  widget: { widget: "incidentList", engines: ["local", "test"], process: "order" },
  groups: [
    {
      engine: "local",
      more: true,
      incidents: [
        {
          id: "inc-1",
          instanceId: "4c1f0a2e-3c1d-11ef-9a3e-0242ac120002",
          definition: ORDER,
          elementId: "Task_Ship",
          type: "failedJob",
          message: "Carrier API answered 503",
          createdAt: "2026-10-26T08:00:00.000Z",
        },
      ],
    },
    { engine: "test", incidents: [] },
  ],
}

export const DIAGRAM: ProcessDiagramData = {
  kind: "processDiagram",
  widget: { widget: "processDiagram", engines: ["local"], process: "order" },
  engine: "local",
  latest: ORDER,
  badges: [{ elementId: "Task_Ship", active: 6, incidents: 3, incidentsInCalledInstances: 0 }],
}

const REFUSED: RefusedData = {
  kind: "refused",
  widget: "chart",
  problems: [
    {
      path: "rows[0].row[1].widget",
      code: "notOneOf",
      values: { choices: ["counter", "instanceList"] },
    },
  ],
}

/** A board of every kind of tile, two rows. */
export const ROWS: readonly (readonly TileData[])[] = [
  [COUNTER, SUMMARY, REFUSED],
  [INSTANCES, INCIDENTS, DIAGRAM],
]
