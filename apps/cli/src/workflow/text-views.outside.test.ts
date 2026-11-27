import { describe, expect, it } from "vitest"
import type { StatusView } from "./status-command.js"
import { statusText } from "./text-views.js"

/** A degraded engine whose processes hold no open incident: the history cleanup's job failed. */
function view(outside: StatusView["outsideAnyProcess"], rootIncidentsTotal: number): StatusView {
  return {
    engine: { url: "http://h", version: "2.1.0", latencyMs: 3 },
    status: "warning",
    findings: [],
    definitions: [],
    incidents: [],
    rootIncidentsTotal,
    ...(outside === undefined ? {} : { outsideAnyProcess: outside }),
    incidentsTotal: rootIncidentsTotal,
    propagated: 0,
    externalTasks: [],
    jobs: { executable: 0, overdue: 0 },
    tasks: { open: 0 },
  }
}

/** The status table's rows under its sections. */
const rows = (text: string) => text.trimEnd().split("\n").slice(-4)

describe("statusText: root incidents outside any process", () => {
  it("puts them on a row of their own, never into the processes' root incidents", () => {
    expect(rows(statusText(view({ count: 1, atLeast: false }, 1), 120))).toEqual([
      "Jobs                 0 executable",
      "Tasks                0 open",
      "Incidents            1 open, 0 root in processes, 0 propagated",
      "Outside any process  1 root incident",
    ])
  })

  it("gives a lower bound where the incidents loaded were cut", () => {
    const text = statusText(view({ count: 3, atLeast: true }, 2001), 120)
    expect(text).toContain("Incidents            2001 open, 1998 root in processes, 0 propagated")
    expect(text).toContain("Outside any process  at least 3 root incidents\n")
  })

  it("keeps the row of root incidents as it was without one, read or not (a scope of keys)", () => {
    for (const outside of [{ count: 0, atLeast: false }, undefined]) {
      const text = statusText(view(outside, 2), 120)
      expect(text).toContain("Incidents  2 open, 2 root, 0 propagated\n")
      expect(text).not.toContain("Outside any process")
    }
  })
})
