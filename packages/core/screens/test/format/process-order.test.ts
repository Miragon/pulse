import { describe, expect, test } from "vitest"
import { ProcessOrder, type ProcessRank } from "../../src/format/process-order.js"

function ordered(ranks: readonly ProcessRank[]): string[] {
  return [...ranks]
    .sort((left, right) => ProcessOrder.compare(left, right))
    .map((rank) => rank.bpmnProcessId)
}

describe("the order of a screen's processes", () => {
  test("puts the most instances with incident first, then the busiest", () => {
    expect(
      ordered([
        { bpmnProcessId: "quiet", running: 1, withIncident: 0 },
        { bpmnProcessId: "busy", running: 9, withIncident: 0 },
        { bpmnProcessId: "failing", running: 0, withIncident: 2 },
        { bpmnProcessId: "worst", running: 1, withIncident: 3 },
      ]),
    ).toEqual(["worst", "failing", "busy", "quiet"])
  })

  test("then sorts by name, whatever its case, and a process without a name by its id", () => {
    expect(
      ordered([
        { bpmnProcessId: "zeta", name: "Zeta", running: 1, withIncident: 0 },
        { bpmnProcessId: "audit", running: 1, withIncident: 0 },
        { bpmnProcessId: "beta", name: "Beta", running: 1, withIncident: 0 },
        { bpmnProcessId: "alpha", name: "alpha", running: 1, withIncident: 0 },
      ]),
    ).toEqual(["alpha", "audit", "beta", "zeta"])
  })

  test("orders two processes of the same name and counts by their ids, so every surface agrees", () => {
    const twins = [
      { bpmnProcessId: "order-b", name: "Order", running: 1, withIncident: 1 },
      { bpmnProcessId: "order-a", name: "Order", running: 1, withIncident: 1 },
    ]

    expect(ordered(twins)).toEqual(["order-a", "order-b"])
    expect(ordered([...twins].reverse())).toEqual(["order-a", "order-b"])
  })

  test("compares a process with itself as equal", () => {
    const rank = { bpmnProcessId: "order", name: "Order", running: 2, withIncident: 1 }

    expect(ProcessOrder.compare(rank, { ...rank })).toBe(0)
  })
})
