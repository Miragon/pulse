import type { BoardIncidentRow, BoardView } from "../../../src/core/protocol/index.js"
import orderXml from "./order-fulfillment.bpmn"
import { AS_OF, LOCAL_ENGINE, minutesBefore } from "./engines.js"

const TEST_ENGINE = { name: "shop-test", environment: "test", host: "localhost:18091" } as const

interface IncidentSeed {
  readonly id: string
  readonly elementId: string
  readonly message: string
  readonly minutes: number
}

function incident(engine: string, { id, elementId, message, minutes }: IncidentSeed) {
  return {
    engine,
    id,
    instanceId: `${id}-instance`,
    shortInstanceId: `${id.slice(0, 8)}…`,
    processName: "Order fulfillment",
    bpmnProcessId: "order-fulfillment",
    elementId,
    message,
    createdAt: minutesBefore(minutes),
  } satisfies BoardIncidentRow
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
        title: "Orders on local",
        engine: "local",
        bpmnProcessId: "order-fulfillment",
        diagram: {
          processName: "Order fulfillment",
          version: 3,
          diagramXml: orderXml,
          badges: [
            {
              elementId: "Activity_CheckCredit",
              running: 4,
              incidents: 0,
              incidentsInCalledInstances: 0,
            },
            {
              elementId: "Activity_ShipOrder",
              running: 6,
              incidents: 3,
              incidentsInCalledInstances: 0,
            },
          ],
        },
      },
      {
        kind: "processDiagram",
        title: "Orders on shop-test",
        engine: "shop-test",
        bpmnProcessId: "order-fulfillment",
        notDeployed: true,
      },
    ],
    [
      {
        kind: "incidentList",
        title: "Open incidents of orders",
        groups: [
          {
            engine: "local",
            rows: [
              incident("local", {
                id: "4c1f0a2e-3c1d",
                elementId: "Activity_ShipOrder",
                message: "Carrier API answered 503",
                minutes: 12,
              }),
              incident("local", {
                id: "5d2e1b3f-3c1d",
                elementId: "Activity_ShipOrder",
                message: "Carrier API answered 503",
                minutes: 40,
              }),
            ],
            more: true,
          },
          { engine: "shop-test", rows: [], unavailable: true },
        ],
      },
    ],
  ],
  problems: [],
}
