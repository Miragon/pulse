import fc from "fast-check"
import { describe, expect, it } from "vitest"
import {
  causeKeyOf,
  criticalIncidentsRule,
  DEFAULT_VERDICT_THRESHOLDS,
  engineVerdict,
  incidentsAtThreshold,
  largestCause,
  rootIncidentCounts,
  type VerdictIncident,
  type VerdictInput,
  type VerdictThresholds,
} from "./verdict.js"

const T: VerdictThresholds = { criticalIncidents: 10, criticalClusterSize: 4 }
const warning = { severity: "warning" } as const
const critical = { severity: "critical" } as const

describe("engineVerdict", () => {
  it.each<[string, VerdictInput, "ok" | "warning" | "critical"]>([
    ["a quiet engine", { openRootIncidents: 0, largestCluster: 0 }, "ok"],
    [
      "a quiet engine without findings",
      { openRootIncidents: 0, largestCluster: 0, findings: [] },
      "ok",
    ],
    ["one open root incident", { openRootIncidents: 1, largestCluster: 1 }, "warning"],
    [
      "open root incidents one under the threshold",
      { openRootIncidents: 9, largestCluster: 3 },
      "warning",
    ],
    [
      "open root incidents at the threshold",
      { openRootIncidents: 10, largestCluster: 1 },
      "critical",
    ],
    ["one cause one under its threshold", { openRootIncidents: 3, largestCluster: 3 }, "warning"],
    ["one cause at its threshold", { openRootIncidents: 4, largestCluster: 4 }, "critical"],
    // a group counted on a capped scan is a lower bound; the total still judges
    ["a large total with small groups", { openRootIncidents: 2000, largestCluster: 1 }, "critical"],
    [
      "a warning finding without incidents",
      { openRootIncidents: 0, largestCluster: 0, findings: [warning] },
      "warning",
    ],
    [
      "a critical finding without incidents",
      { openRootIncidents: 0, largestCluster: 0, findings: [critical] },
      "critical",
    ],
    [
      "a critical finding beside warnings",
      { openRootIncidents: 1, largestCluster: 1, findings: [warning, critical] },
      "critical",
    ],
  ])("%s", (_, input, verdict) => {
    expect(engineVerdict(input, T)).toBe(verdict)
  })

  it("takes the cockpit's defaults when no thresholds are given: 50 open root, 25 of one cause", () => {
    expect(DEFAULT_VERDICT_THRESHOLDS).toEqual({ criticalIncidents: 50, criticalClusterSize: 25 })
    expect(engineVerdict({ openRootIncidents: 49, largestCluster: 24 })).toBe("warning")
    expect(engineVerdict({ openRootIncidents: 50, largestCluster: 1 })).toBe("critical")
    expect(engineVerdict({ openRootIncidents: 25, largestCluster: 25 })).toBe("critical")
  })

  it("never judges a busier engine better", () => {
    const rank = { ok: 0, warning: 1, critical: 2 }
    const findings = fc.array(
      fc.constantFrom("warning" as const, "critical" as const).map((severity) => ({ severity })),
      { maxLength: 4 },
    )
    const input = fc.record({
      openRootIncidents: fc.nat(200),
      largestCluster: fc.nat(200),
      findings,
    })
    fc.assert(
      fc.property(input, input, (before, more) => {
        const busier: VerdictInput = {
          openRootIncidents: before.openRootIncidents + more.openRootIncidents,
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
    expect(criticalIncidentsRule(T)).toBe(">=10 open root incidents or >=4 of one cause")
    expect(criticalIncidentsRule()).toBe(">=50 open root incidents or >=25 of one cause")
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
    expect(incidentsAtThreshold({ openRootIncidents: 10, largestCluster: 0 }, T)).toBe(true)
    expect(incidentsAtThreshold({ openRootIncidents: 9, largestCluster: 4 }, T)).toBe(true)
    expect(incidentsAtThreshold({ openRootIncidents: 9, largestCluster: 3 }, T)).toBe(false)
  })
})

describe("rootIncidentCounts", () => {
  /** A failed job raised at `activityId`, a root incident unless it copies `root`. */
  const raised = (
    id: string,
    activityId: string,
    incidentMessage: string | null,
    {
      root = id,
      processDefinitionId = "order:1:x",
    }: { readonly root?: string; readonly processDefinitionId?: string | null } = {},
  ): VerdictIncident => ({
    id,
    rootCauseIncidentId: root,
    activityId,
    incidentType: "failedJob",
    incidentMessage,
    processDefinitionId,
  })

  /**
   * One failure at the end of a chain of `calls` call activities: its root incident in the called
   * instance at the bottom, and Camunda 7's copy of it at each call activity above, without a
   * message.
   */
  function chain(id: string, calls: number): VerdictIncident[] {
    const root = raised(id, "printLabel", "Printer offline at 'P-7'", {
      processDefinitionId: "label:1:x",
    })
    const copies = Array.from({ length: calls }, (_, level) =>
      raised(`${id}-copy-${level}`, `call${level}`, null, {
        root: id,
        processDefinitionId: `caller${level}:1:x`,
      }),
    )
    return [root, ...copies]
  }

  it("counts a chain of calls that one failure stops as that one failure", () => {
    // The statistics with rootIncidents=true count the label process's one root incident.
    const counts = rootIncidentCounts(1, chain("f1", 4))
    expect(counts).toEqual({
      openRootIncidents: 1,
      largestCluster: 1,
      largestCause: causeKeyOf({
        activityId: "printLabel",
        incidentType: "failedJob",
        incidentMessage: "Printer offline at 'P-7'",
      }),
    })
    // Five open incidents with the copies would have made it critical at a threshold of 5.
    const T5: VerdictThresholds = { criticalIncidents: 5, criticalClusterSize: 99 }
    expect(engineVerdict(counts, T5)).toBe("warning")
    expect(engineVerdict({ openRootIncidents: 5, largestCluster: 1 }, T5)).toBe("critical")
  })

  it("never lets the copies at one call activity raise the largest cause", () => {
    // Four failures of four causes in four called instances, each copied to the one call activity
    // of its caller: the copies share a cause (no message), the root incidents do not.
    const incidents = ["a", "b", "c", "d"].flatMap((name) => [
      raised(name, `task-${name}`, `failed ${name}`),
      raised(`${name}-copy`, "callCheck", null, { root: name, processDefinitionId: "leasing:1:l" }),
    ])
    const counts = rootIncidentCounts(4, incidents)
    expect(counts.largestCluster).toBe(1)
    expect(largestCause(incidents)?.count).toBe(4)
    expect(engineVerdict(counts, T)).toBe("warning")
  })

  it("adds the root incidents outside any process, which no statistics row counts", () => {
    const outside = [
      raised("batch", "(batch)", "Migration failed", { processDefinitionId: null }),
      raised("cleanup", "(cleanup)", "History cleanup failed", { processDefinitionId: "" }),
      // A copy is never outside a process; one without its definition still counts as none.
      raised("stray-copy", "call", null, { root: "batch", processDefinitionId: null }),
    ]
    expect(rootIncidentCounts(2, outside)).toMatchObject({
      openRootIncidents: 4,
      largestCluster: 1,
    })
    expect(rootIncidentCounts(0, [])).toEqual({ openRootIncidents: 0, largestCluster: 0 })
  })

  it("reads an incident without a rootCauseIncidentId as a root, as c7-core's rule decides", () => {
    const counts = rootIncidentCounts(0, [
      { activityId: "a", incidentType: "failedJob", incidentMessage: "x" },
      { activityId: "a", incidentType: "failedJob", incidentMessage: "x", processDefinitionId: 7 },
    ])
    expect(counts).toMatchObject({ openRootIncidents: 2, largestCluster: 2 })
  })
})
