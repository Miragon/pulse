import { describe, expect, test } from "vitest"
import { FleetSums, type EngineScreenData, type ProcessRowData } from "../../src/index.js"

const AS_OF = "2026-11-19T09:00:00.000Z"
const INFO = { product: "CIB seven", version: "2.0.1" }

function screenOf(
  engine: string,
  processes: readonly ProcessRowData[],
  info: EngineScreenData["info"] = null,
): EngineScreenData {
  return {
    engine,
    asOf: AS_OF,
    info,
    processes,
    totals: {
      processes: processes.length,
      running: processes.reduce((sum, row) => sum + row.running, 0),
      withIncident: processes.reduce((sum, row) => sum + row.withIncident, 0),
    },
  }
}

const PROD_A = screenOf("prod-a", [
  {
    bpmnProcessId: "order",
    name: "Order fulfillment",
    latestVersion: 7,
    running: 15,
    withIncident: 9,
    incidents: 2,
  },
  { bpmnProcessId: "shipment", latestVersion: 1, running: 1204, withIncident: 0, incidents: 0 },
])
const PROD_B = screenOf(
  "prod-b",
  [
    {
      bpmnProcessId: "credit",
      name: "Assess creditworthiness",
      latestVersion: 3,
      running: 160,
      withIncident: 64,
      incidents: 33,
    },
  ],
  INFO,
)
const C8_EU = screenOf("c8-eu", [
  {
    bpmnProcessId: "shipment",
    name: "Shipment",
    latestVersion: 2,
    running: 10,
    withIncident: 1,
    incidents: 1,
  },
  { bpmnProcessId: "order", latestVersion: 4, running: 88, withIncident: 3, incidents: 3 },
])

describe("the sums across engines", () => {
  test("give each engine's row the totals of its engine screen and the incidents of its rows, in the order the engines come", () => {
    expect(FleetSums.of([PROD_A, PROD_B, C8_EU]).engines).toEqual([
      { engine: "prod-a", info: null, processes: 2, running: 1219, withIncident: 9, incidents: 2 },
      { engine: "prod-b", info: INFO, processes: 1, running: 160, withIncident: 64, incidents: 33 },
      { engine: "c8-eu", info: null, processes: 2, running: 98, withIncident: 4, incidents: 4 },
    ])
  })

  test("take an engine's totals as its screen says them, never from its rows", () => {
    const counted = { ...PROD_B, totals: { processes: 5, running: 200, withIncident: 70 } }

    const sums = FleetSums.of([counted])

    expect(sums.engines).toEqual([
      { engine: "prod-b", info: INFO, processes: 5, running: 200, withIncident: 70, incidents: 33 },
    ])
    expect(sums.totals).toEqual({ processes: 1, running: 200, withIncident: 70, incidents: 33 })
  })

  test("call an engine's incidents and the totals' a lower bound where one of its rows stopped counting", () => {
    const stopped = screenOf("c8-big", [
      {
        bpmnProcessId: "order",
        latestVersion: 1,
        running: 12_000,
        withIncident: 10_000,
        incidents: 10_000,
        incidentsAtLeast: true,
      },
      { bpmnProcessId: "audit", latestVersion: 1, running: 3, withIncident: 1, incidents: 2 },
    ])

    const sums = FleetSums.of([PROD_A, stopped])

    expect(
      sums.engines.map(({ incidents, incidentsAtLeast }) => [incidents, incidentsAtLeast]),
    ).toEqual([
      [2, undefined],
      [10_002, true],
    ])
    expect(sums.engines[0]).not.toHaveProperty("incidentsAtLeast")
    expect(sums.totals).toMatchObject({ incidents: 10_004, incidentsAtLeast: true })
    expect(FleetSums.of([PROD_A, PROD_B]).totals).not.toHaveProperty("incidentsAtLeast")
  })

  test("sum each process over the engines it runs on, with a cell per engine in their order", () => {
    expect(FleetSums.of([PROD_A, PROD_B, C8_EU]).processes).toEqual([
      {
        bpmnProcessId: "credit",
        name: "Assess creditworthiness",
        running: 160,
        withIncident: 64,
        engines: [{ engine: "prod-b", running: 160, withIncident: 64 }],
      },
      {
        bpmnProcessId: "order",
        name: "Order fulfillment",
        running: 103,
        withIncident: 12,
        engines: [
          { engine: "prod-a", running: 15, withIncident: 9 },
          { engine: "c8-eu", running: 88, withIncident: 3 },
        ],
      },
      {
        bpmnProcessId: "shipment",
        name: "Shipment",
        running: 1214,
        withIncident: 1,
        engines: [
          { engine: "prod-a", running: 1204, withIncident: 0 },
          { engine: "c8-eu", running: 10, withIncident: 1 },
        ],
      },
    ])
  })

  test("name a process by the first engine that names it, and leave the name out where none does", () => {
    const nameless = screenOf("prod-x", [
      { bpmnProcessId: "audit", latestVersion: 1, running: 1, withIncident: 0, incidents: 0 },
    ])

    const [audit] = FleetSums.of([nameless, nameless]).processes

    expect(audit).not.toHaveProperty("name")
    expect(audit?.running).toBe(2)
  })

  test("count every process once over all engines, and sum the engines' totals", () => {
    expect(FleetSums.of([PROD_A, PROD_B, C8_EU]).totals).toEqual({
      processes: 3,
      running: 1477,
      withIncident: 77,
      incidents: 39,
    })
  })

  test("give nothing to sum for no engine", () => {
    expect(FleetSums.of([])).toEqual({
      engines: [],
      processes: [],
      totals: { processes: 0, running: 0, withIncident: 0, incidents: 0 },
    })
  })
})
