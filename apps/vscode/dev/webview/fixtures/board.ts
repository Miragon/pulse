import type { BoardView } from "../../../src/core/protocol/index.js"
import { AS_OF, LOCAL_ENGINE, minutesBefore, PROD_ENGINE } from "./engines.js"

const TEST_ENGINE = { name: "shop-test", environment: "test", host: "localhost:18091" } as const
const RUNNING_ORDERS = { scope: "running", elementId: "Activity_AwaitPayment" } as const

function order(engine: string, id: string, businessKey: string, minutes: number) {
  return {
    engine,
    id,
    shortId: `${id.slice(0, 8)}…`,
    processName: "Order fulfillment",
    bpmnProcessId: "order-fulfillment",
    version: 3,
    state: "Running",
    hasIncident: businessKey === "ORD-10007",
    businessKey,
    startedAt: minutesBefore(minutes),
  } as const
}

export const BOARD_VIEW: BoardView = {
  kind: "board",
  asOf: AS_OF,
  title: "Shop operations",
  fileName: "shop-operations.board.json",
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
    {
      name: "prod-eu",
      state: "failed",
      badge: PROD_ENGINE,
      problem: {
        title: "Can't reach prod-eu.",
        detail: "Cannot reach https://prod-eu.shop.invalid/engine-rest (ENOTFOUND)",
        canEditConnection: true,
      },
    },
    { name: "billing-prod", state: "notConfigured" },
  ],
  rows: [
    [
      {
        kind: "counter",
        title: "Waiting for payment",
        total: 12,
        known: 2,
        warnAbove: 5,
        entries: [
          {
            engine: "local",
            count: 10,
            above: true,
            target: { engine: "local", bpmnProcessId: "order-fulfillment", filter: RUNNING_ORDERS },
          },
          {
            engine: "shop-test",
            count: 2,
            target: {
              engine: "shop-test",
              bpmnProcessId: "order-fulfillment",
              filter: RUNNING_ORDERS,
            },
          },
          {
            engine: "prod-eu",
            target: {
              engine: "prod-eu",
              bpmnProcessId: "order-fulfillment",
              filter: RUNNING_ORDERS,
            },
          },
        ],
      },
      {
        kind: "incidentSummary",
        title: "Incidents per process",
        groupBy: "process",
        total: 14,
        known: 2,
        engines: 3,
        rows: [
          {
            engine: "local",
            label: "Order fulfillment",
            withIncident: 10,
            target: {
              engine: "local",
              bpmnProcessId: "order-fulfillment",
              filter: { scope: "withIncident" },
            },
          },
          {
            engine: "shop-test",
            label: "Order fulfillment",
            withIncident: 1,
            target: {
              engine: "shop-test",
              bpmnProcessId: "order-fulfillment",
              filter: { scope: "withIncident" },
            },
          },
        ],
      },
    ],
    [
      {
        kind: "instanceList",
        title: "Orders waiting for payment",
        columns: ["engine", "businessKey", "version", "startedAt", "incident"],
        groups: [
          {
            engine: "local",
            total: 10,
            rows: [
              order("local", "67f0c97a-3c1d-11ef-9a3e-0242ac120002", "ORD-10164", 14),
              order("local", "81a2e0b4-3c1d-11ef-9a3e-0242ac120002", "ORD-10163", 18),
            ],
          },
          {
            engine: "shop-test",
            total: 2,
            rows: [order("shop-test", "9b1c4d22-3c1d-11ef-9a3e-0242ac120002", "ORD-10007", 30)],
          },
          { engine: "prod-eu", rows: [], unavailable: true },
        ],
      },
    ],
  ],
  problems: [],
}

export const BROKEN_BOARD_VIEW: BoardView = {
  ...BOARD_VIEW,
  problems: [
    {
      path: "rows[0].row[0].props.filter.activeElement",
      reason: "needs a process: element ids are only unique within one process",
    },
  ],
}
