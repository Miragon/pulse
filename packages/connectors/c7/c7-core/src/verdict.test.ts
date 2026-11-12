import fc from "fast-check"
import { describe, expect, it } from "vitest"
import {
  causeKeyOf,
  criticalIncidentsRule,
  DEFAULT_VERDICT_THRESHOLDS,
  engineVerdict,
  incidentsAtThreshold,
  largestCause,
  type VerdictInput,
  type VerdictThresholds,
} from "./verdict.js"

const T: VerdictThresholds = { criticalIncidents: 10, criticalClusterSize: 4 }
const warning = { severity: "warning" } as const
const critical = { severity: "critical" } as const

describe("engineVerdict", () => {
  it.each<[string, VerdictInput, "ok" | "warning" | "critical"]>([
    ["a quiet engine", { openIncidents: 0, largestCluster: 0 }, "ok"],
    [
      "a quiet engine without findings",
      { openIncidents: 0, largestCluster: 0, findings: [] },
      "ok",
    ],
    ["one open incident", { openIncidents: 1, largestCluster: 1 }, "warning"],
    ["open incidents one under the threshold", { openIncidents: 9, largestCluster: 3 }, "warning"],
    ["open incidents at the threshold", { openIncidents: 10, largestCluster: 1 }, "critical"],
    ["one cause one under its threshold", { openIncidents: 3, largestCluster: 3 }, "warning"],
    ["one cause at its threshold", { openIncidents: 4, largestCluster: 4 }, "critical"],
    // a group counted on a capped scan is a lower bound; the total still judges
    ["a large total with small groups", { openIncidents: 2000, largestCluster: 1 }, "critical"],
    [
      "a warning finding without incidents",
      { openIncidents: 0, largestCluster: 0, findings: [warning] },
      "warning",
    ],
    [
      "a critical finding without incidents",
      { openIncidents: 0, largestCluster: 0, findings: [critical] },
      "critical",
    ],
    [
      "a critical finding beside warnings",
      { openIncidents: 1, largestCluster: 1, findings: [warning, critical] },
      "critical",
    ],
  ])("%s", (_, input, verdict) => {
    expect(engineVerdict(input, T)).toBe(verdict)
  })

  it("takes the cockpit's defaults when no thresholds are given: 50 open, 25 of one cause", () => {
    expect(DEFAULT_VERDICT_THRESHOLDS).toEqual({ criticalIncidents: 50, criticalClusterSize: 25 })
    expect(engineVerdict({ openIncidents: 49, largestCluster: 24 })).toBe("warning")
    expect(engineVerdict({ openIncidents: 50, largestCluster: 1 })).toBe("critical")
    expect(engineVerdict({ openIncidents: 25, largestCluster: 25 })).toBe("critical")
  })

  it("never judges a busier engine better", () => {
    const rank = { ok: 0, warning: 1, critical: 2 }
    const findings = fc.array(
      fc.constantFrom("warning" as const, "critical" as const).map((severity) => ({ severity })),
      { maxLength: 4 },
    )
    const input = fc.record({
      openIncidents: fc.nat(200),
      largestCluster: fc.nat(200),
      findings,
    })
    fc.assert(
      fc.property(input, input, (before, more) => {
        const busier: VerdictInput = {
          openIncidents: before.openIncidents + more.openIncidents,
          largestCluster: before.largestCluster + more.largestCluster,
          findings: [...before.findings, ...more.findings],
        }
        expect(rank[engineVerdict(busier, T)]).toBeGreaterThanOrEqual(
          rank[engineVerdict(before, T)],
        )
      }),
    )
  })
})

describe("criticalIncidentsRule", () => {
  it("words the thresholds in force", () => {
    expect(criticalIncidentsRule(T)).toBe(">=10 open incidents or >=4 of one cause")
    expect(criticalIncidentsRule()).toBe(">=50 open incidents or >=25 of one cause")
  })
})

describe("causeKeyOf", () => {
  it("is the cockpit's cluster id: activity, type and message signature", () => {
    expect(
      causeKeyOf({
        activityId: "book",
        incidentType: "failedJob",
        incidentMessage: "Timeout calling 'svc-1' after 30 ms",
      }),
    ).toEqual({
      activityId: "book",
      incidentType: "failedJob",
      signature: "timeout calling '<v>' after <n> ms",
      key: "book::failedJob::timeout calling '<v>' after <n> ms",
    })
  })

  it("names a missing activity, type or message as the cockpit always did", () => {
    expect(causeKeyOf({ activityId: null, incidentType: undefined }).key).toBe(
      "(unknown)::unknown::",
    )
  })
})

describe("largestCause", () => {
  const incident = (activityId: string, incidentMessage: string) => ({
    activityId,
    incidentType: "failedJob",
    incidentMessage,
  })

  it("counts one cause over messages that differ in volatile tokens only", () => {
    const largest = largestCause([
      incident("a", "x"),
      incident("book", "Timeout after 10 ms"),
      incident("book", "timeout after 20 ms"),
    ])
    expect(largest).toMatchObject({ count: 2, cause: { activityId: "book" } })
  })

  it("keeps the first cause seen on a tie and is undefined without incidents", () => {
    expect(largestCause([incident("a", "x"), incident("b", "x")])?.cause.activityId).toBe("a")
    expect(largestCause([])).toBeUndefined()
  })
})

describe("incidentsAtThreshold", () => {
  it("is engineVerdict's incident rule alone", () => {
    expect(incidentsAtThreshold({ openIncidents: 10, largestCluster: 0 }, T)).toBe(true)
    expect(incidentsAtThreshold({ openIncidents: 9, largestCluster: 4 }, T)).toBe(true)
    expect(incidentsAtThreshold({ openIncidents: 9, largestCluster: 3 }, T)).toBe(false)
  })
})
