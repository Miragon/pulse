import { describe, expect, test } from "vitest"
import { ProcessFilter, type ProcessRowData } from "../../src/index.js"

const ORDER: ProcessRowData = {
  bpmnProcessId: "pulse-order",
  name: "Order fulfillment",
  latestVersion: 2,
  running: 3,
  withIncident: 1,
  incidents: 1,
}
const SHIPMENT: ProcessRowData = {
  bpmnProcessId: "shipment",
  latestVersion: 1,
  running: 1204,
  withIncident: 0,
  incidents: 0,
}
const LABEL: ProcessRowData = {
  bpmnProcessId: "pulse-label",
  name: "Print label",
  latestVersion: 1,
  running: 1,
  withIncident: 1,
  incidents: 1,
}
const ROWS = [ORDER, SHIPMENT, LABEL]
const BILLING: ProcessRowData = {
  bpmnProcessId: "billing-run",
  name: "Nightly billing",
  latestVersion: 4,
  running: 0,
  withIncident: 0,
  incidents: 1,
}

const DISPATCH: ProcessRowData = {
  bpmnProcessId: "pulse-dispatch",
  latestVersion: 1,
  running: 1,
  withIncident: 1,
  incidents: 0,
}

function idsOf(rows: readonly ProcessRowData[]): string[] {
  return rows.map((row) => row.bpmnProcessId)
}

describe("the filter of a process list", () => {
  test("keeps every row in its order for all processes and counts both scopes", () => {
    const filtered = ProcessFilter.apply(ROWS, { scope: "all" })

    expect(filtered.processes).toEqual(ROWS)
    expect(filtered.counts).toEqual({ all: 3, withIncident: 2 })
  })

  test("keeps the rows with an instance with incident in that scope, and counts all the same", () => {
    const filtered = ProcessFilter.apply(ROWS, { scope: "withIncident" })

    expect(idsOf(filtered.processes)).toEqual(["pulse-order", "pulse-label"])
    expect(filtered.counts).toEqual({ all: 3, withIncident: 2 })
  })

  test("keeps a process whose incident lies in no instance in that scope, and counts it there", () => {
    const filtered = ProcessFilter.apply([...ROWS, BILLING], { scope: "withIncident" })

    expect(idsOf(filtered.processes)).toEqual(["pulse-order", "pulse-label", "billing-run"])
    expect(filtered.counts).toEqual({ all: 4, withIncident: 3 })
  })

  test("keeps a caller waiting for an incident in an instance it called in that scope", () => {
    const filtered = ProcessFilter.apply([SHIPMENT, DISPATCH], { scope: "withIncident" })

    expect(idsOf(filtered.processes)).toEqual(["pulse-dispatch"])
    expect(filtered.counts).toEqual({ all: 2, withIncident: 1 })
  })

  test("searches the name in any case", () => {
    const filtered = ProcessFilter.apply(ROWS, { scope: "all", search: "PRINT" })

    expect(idsOf(filtered.processes)).toEqual(["pulse-label"])
    expect(filtered.counts).toEqual({ all: 1, withIncident: 1 })
  })

  test("searches the BPMN process id of a named process too", () => {
    const filtered = ProcessFilter.apply(ROWS, { scope: "withIncident", search: "pulse-ord" })

    expect(idsOf(filtered.processes)).toEqual(["pulse-order"])
  })

  test("searches the id of a process without a name", () => {
    const filtered = ProcessFilter.apply(ROWS, { scope: "all", search: "SHIP" })

    expect(idsOf(filtered.processes)).toEqual(["shipment"])
    expect(filtered.counts).toEqual({ all: 1, withIncident: 0 })
  })

  test("counts what the search leaves, nothing when it finds nothing", () => {
    const filtered = ProcessFilter.apply(ROWS, { scope: "all", search: "invoice" })

    expect(filtered).toEqual({ processes: [], counts: { all: 0, withIncident: 0 } })
  })

  test("reads an empty search as no search", () => {
    expect(ProcessFilter.apply(ROWS, { scope: "all", search: "" })).toEqual(
      ProcessFilter.apply(ROWS, { scope: "all" }),
    )
  })
})
