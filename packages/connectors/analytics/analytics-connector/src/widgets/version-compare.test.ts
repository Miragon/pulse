import { describe, expect, it } from "vitest"
import type { VersionCompareKpi, VersionCompareResult } from "@miragon/pulse-analytics-client"
import { versionCompareHandOff } from "./version-compare.js"
import { bindHandOff } from "./hand-off.js"

const versionKpi = (version: number, incidentRatePct: number): VersionCompareKpi => ({
  version,
  startedCount: 100,
  completedCount: 90,
  incidentsCreated: incidentRatePct,
  incidentRatePct,
  elementIncidentsCreated: null,
  elementIncidentRatePct: null,
  avgDurationMs: 10_000,
  medianDurationMs: 8_000,
  p95DurationMs: 20_000,
})

const result: VersionCompareResult = {
  engines: ["prod-a"],
  processDefinitionKey: "order",
  versionA: 1,
  versionB: 2,
  windowDays: 14,
  minBucketSize: 10,
  suppressed: false,
  kpis: [versionKpi(1, 2), versionKpi(2, 2.5)],
  delta: {
    startedPerDayDeltaPct: 0,
    incidentRateDeltaPp: 0.5,
    elementIncidentRateDeltaPp: null,
    avgDurationDeltaPct: 25,
    p95DurationDeltaPct: 40,
  },
  asOf: "2026-10-10T12:32:00.000Z",
}

const prompt = (data: VersionCompareResult) => bindHandOff("en").ask(versionCompareHandOff(data))!

describe("versionCompareHandOff", () => {
  it("re-runs the process-wide comparison on the engines on screen, never an element scope", () => {
    const text = prompt(result)

    expect(text).toContain(
      'Ids: engine="prod-a", processDefinitionKey="order", versionA=1, versionB=2, windowDays=14\n',
    )
    // The tool takes no element scope (#336); the hand-off must not suggest one.
    expect(text).not.toContain("activityId")
  })

  it("carries the measured deltas, the incident rate per version included", () => {
    const text = prompt(result)
    expect(text).toContain("incidentRateDeltaPp=0.5")
    expect(text).toContain("avgDurationDeltaPct=25")
    expect(text).not.toContain("elementIncidentRateDeltaPp")
  })

  it("leaves a null delta out instead of sending it as 0", () => {
    const text = prompt({ ...result, delta: { ...result.delta, p95DurationDeltaPct: null } })
    expect(text).not.toContain("p95DurationDeltaPct")
  })

  it("names no tool", () => {
    expect(prompt(result)).not.toMatch(/\b(engine|analytics)_[a-z0-9_]+/)
  })
})
