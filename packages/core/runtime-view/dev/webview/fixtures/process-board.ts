import type { BoardView, IncidentData } from "../../../src/core/protocol/index.js"
import orderXml from "./order-fulfillment.bpmn"
import { AS_OF, LOCAL_ENGINE, minutesBefore } from "./engines.js"

const TEST_ENGINE = { name: "shop-test", environment: "test", host: "localhost:18091" } as const
const ORDER_FULFILLMENT = {
  id: "order-fulfillment:3",
  bpmnProcessId: "order-fulfillment",
  version: 3,
  name: "Order fulfillment",
} as const

interface IncidentSeed {
  readonly id: string
  readonly elementId: string
  readonly message: string
  readonly minutes: number
}

function incident({ id, elementId, message, minutes }: IncidentSeed): IncidentData {
  return {
    id,
    instanceId: `${id}-instance`,
    definition: ORDER_FULFILLMENT,
    elementId,
    type: "failedJob",
    message,
    createdAt: minutesBefore(minutes),
  }
}

function diagram(title: string, engine: string) {
  return {
    widget: "processDiagram",
    title,
    engines: [engine],
    process: "order-fulfillment",
  } as const
}

export const PROCESS_BOARD_VIEW: BoardView = {
  kind: "board",
  asOf: AS_OF,
  title: "Order fulfillment",
  fileName: "order-fulfillment.board.json",
  engines: [
    {
      name: "local",
      state: "ready",
      badge: LOCAL_ENGINE,
      product: "Operaton 2.1.5",
      running: 172,
      withIncident: 13,
    },
    {
      name: "shop-test",
      state: "ready",
      badge: TEST_ENGINE,
      product: "CIB seven 2.2.0",
      running: 9,
      withIncident: 1,
    },
  ],
  rows: [
    [
      {
        kind: "processDiagram",
        widget: diagram("Orders on local", "local"),
        engine: "local",
        latest: ORDER_FULFILLMENT,
        badges: [
          {
            elementId: "Activity_CheckCredit",
            active: 4,
            incidents: 0,
            incidentsInCalledInstances: 0,
          },
          {
            elementId: "Activity_ShipOrder",
            active: 6,
            incidents: 3,
            incidentsInCalledInstances: 0,
          },
        ],
        diagramXml: orderXml,
      },
      {
        kind: "processDiagram",
        widget: diagram("Orders on shop-test", "shop-test"),
        engine: "shop-test",
        notDeployed: true,
      },
    ],
    [
      {
        kind: "incidentList",
        widget: {
          widget: "incidentList",
          title: "Open incidents of orders",
          engines: ["local", "shop-test"],
          process: "order-fulfillment",
        },
        groups: [
          {
            engine: "local",
            incidents: [
              incident({
                id: "4c1f0a2e-3c1d",
                elementId: "Activity_ShipOrder",
                message: "Carrier API answered 503",
                minutes: 12,
              }),
              incident({
                id: "5d2e1b3f-3c1d",
                elementId: "Activity_ShipOrder",
                message: "Carrier API answered 503",
                minutes: 40,
              }),
            ],
            more: true,
          },
          { engine: "shop-test" },
        ],
      },
    ],
  ],
  problems: [],
  notes: [],
}
