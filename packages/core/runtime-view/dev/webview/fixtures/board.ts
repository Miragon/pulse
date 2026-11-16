import type { BoardTarget, BoardView, InstanceData } from "../../../src/core/protocol/index.js"
import { AS_OF, LOCAL_ENGINE, minutesBefore, PROD_ENGINE } from "./engines.js"

const TEST_ENGINE = { name: "shop-test", environment: "test", host: "localhost:18091" } as const
const ENGINES = ["local", "shop-test", "prod-eu"]
const WAITING_FOR_PAYMENT = {
  process: "order-fulfillment",
  activeElement: "Activity_AwaitPayment",
  state: "running",
} as const
const RUNNING_ORDERS = { scope: "running", elementId: "Activity_AwaitPayment" } as const
const ORDER_FULFILLMENT = {
  id: "order-fulfillment:3",
  bpmnProcessId: "order-fulfillment",
  version: 3,
  name: "Order fulfillment",
} as const

function target(engine: string, filter: BoardTarget["filter"]): BoardTarget {
  return { engine, bpmnProcessId: "order-fulfillment", filter }
}

function order(id: string, businessKey: string, minutes: number): InstanceData {
  return {
    id,
    definition: ORDER_FULFILLMENT,
    state: "running",
    hasIncident: businessKey === "ORD-10007",
    businessKey,
    startedAt: minutesBefore(minutes),
  }
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
        detail:
          "Cannot reach https://prod-eu.shop.invalid/engine-rest/telemetry/data: the host name does not resolve (ENOTFOUND). Check the host name in the engine URL.",
        canEditConnection: true,
      },
    },
    { name: "billing-prod", state: "notConfigured" },
  ],
  rows: [
    [
      {
        kind: "counter",
        widget: {
          widget: "counter",
          title: "Waiting for payment",
          engines: ENGINES,
          filter: WAITING_FOR_PAYMENT,
          warnAbove: 5,
        },
        readings: [
          { engine: "local", count: { count: 10 }, above: true },
          { engine: "shop-test", count: { count: 2 } },
          { engine: "prod-eu" },
        ],
        known: 2,
        total: { count: 12 },
        targets: ENGINES.map((engine) => target(engine, RUNNING_ORDERS)),
      },
      {
        kind: "incidentSummary",
        widget: {
          widget: "incidentSummary",
          title: "With incident per process",
          engines: ENGINES,
          groupBy: "process",
        },
        engines: 3,
        known: 2,
        total: 14,
        rows: [
          { engine: "local", process: ORDER_FULFILLMENT, withIncident: 10 },
          { engine: "shop-test", process: ORDER_FULFILLMENT, withIncident: 1 },
        ],
        targets: ["local", "shop-test"].map((engine) => target(engine, { scope: "withIncident" })),
      },
    ],
    [
      {
        kind: "instanceList",
        widget: {
          widget: "instanceList",
          title: "Orders waiting for payment",
          engines: ENGINES,
          filter: WAITING_FOR_PAYMENT,
          columns: ["engine", "businessKey", "version", "startedAt", "incident"],
        },
        groups: [
          {
            engine: "local",
            total: { count: 10 },
            instances: [
              order("67f0c97a-3c1d-11ef-9a3e-0242ac120002", "ORD-10164", 14),
              order("81a2e0b4-3c1d-11ef-9a3e-0242ac120002", "ORD-10163", 18),
            ],
          },
          {
            engine: "shop-test",
            total: { count: 2 },
            instances: [order("9b1c4d22-3c1d-11ef-9a3e-0242ac120002", "ORD-10007", 30)],
          },
          { engine: "prod-eu" },
        ],
      },
    ],
  ],
  problems: [],
  notes: [],
}

export const BROKEN_BOARD_VIEW: BoardView = {
  ...BOARD_VIEW,
  problems: [{ path: "title", code: "blankText" }],
}

export const REFUSED_BOARD_VIEW: BoardView = {
  ...BOARD_VIEW,
  rows: [
    [
      ...(BOARD_VIEW.rows[0] ?? []).slice(0, 1),
      {
        kind: "refused",
        title: "Ended orders with incident",
        widget: "counter",
        problems: [
          {
            path: "rows[0].row[1].props.filter.withIncident",
            code: "endedWithIncident",
          },
        ],
      },
    ],
    ...BOARD_VIEW.rows.slice(1),
    [
      {
        kind: "refused",
        widget: "chart",
        problems: [
          {
            path: "rows[2].row[0].widget",
            code: "notOneOf",
            values: {
              choices: [
                "counter",
                "instanceList",
                "incidentSummary",
                "processDiagram",
                "incidentList",
              ],
            },
          },
        ],
      },
    ],
  ],
  notes: [
    {
      path: "layout",
      code: "ignoredKey",
    },
  ],
}
