import { describe, expect, it } from "vitest"
import {
  describeEngineLandscape,
  describeErrorPatterns,
  describeFailureRates,
  describeFailureSummary,
  describeVersionCompare,
} from "./model-descriptions.js"
import type {
  EngineLandscapeEngine,
  EngineLandscapeResult,
  FailureDashboardData,
  VersionCompareKpi,
  VersionCompareResult,
} from "@miragon/pulse-analytics-client"

// The dashboard, comparison and heatmap descriptions: model-descriptions.dashboard.test.ts.

const engine = (
  engineId: string,
  over: Partial<EngineLandscapeEngine> = {},
): EngineLandscapeEngine => ({
  engineId,
  reporting: true,
  runningInstances: 0,
  openIncidents: 0,
  failedJobs: 0,
  executableJobs: 0,
  suspendedJobs: 0,
  jobsDueFuture: 0,
  openExternalTasks: 0,
  deployedDefinitionKeys: 0,
  exclusiveDefinitionKeys: 0,
  ...over,
})

const landscape = (over: Partial<EngineLandscapeResult> = {}): EngineLandscapeResult => ({
  engines: [
    engine("prod-a", { runningInstances: 12, executableJobs: 3, deployedDefinitionKeys: 2 }),
    engine("prod-b", { runningInstances: 4, executableJobs: 90, deployedDefinitionKeys: 1 }),
  ],
  processes: [],
  sharedProcessKeys: ["order"],
  totals: {
    engineCount: 2,
    reportingEngineCount: 2,
    processKeyCount: 3,
    sharedProcessKeyCount: 1,
    runningInstances: 16,
    openIncidents: 2,
    failedJobs: 0,
  },
  ...over,
})

describe("describeEngineLandscape", () => {
  it("names the busiest engine, the largest backlog and the comparable process", () => {
    const text = describeEngineLandscape(landscape(), {})

    expect(text).toContain('busiestEngine="prod-a", busiestRunningInstances=12')
    expect(text).toContain('largestBacklogEngine="prod-b", largestBacklogExecutableJobs=90')
    expect(text).toContain('sharedProcessKeys=["order"]')
    expect(text).toContain("Tools: analytics_engine_compare, analytics_engine_health")
  })

  it("tells the model why per-engine rates are absent", () => {
    // Without it a model would divide the counts into per-engine rates and compare them.
    expect(describeEngineLandscape(landscape(), {})).toContain("different process mixes")
  })

  it("states that no valid engine comparison exists when nothing is shared", () => {
    const text = describeEngineLandscape(landscape({ sharedProcessKeys: [] }), {})

    expect(text).toContain("No definition runs on more than one engine")
    // Without a shared definition there is nothing to compare: no compare tool.
    expect(text).not.toContain("analytics_engine_compare")
    expect(text).toContain("Tools: analytics_engine_health")
  })

  it("calls out engines that report no metrics at all", () => {
    const text = describeEngineLandscape(
      landscape({
        engines: [
          engine("prod-a", { runningInstances: 1 }),
          engine("prod-c", { reporting: false }),
        ],
      }),
      {},
    )

    expect(text).toContain('enginesReportingNoMetrics=["prod-c"]')
  })
})

const versionKpi = (version: number, over: Partial<VersionCompareKpi> = {}): VersionCompareKpi => ({
  version,
  bucket: version === 1 ? "versionA" : "versionB",
  instance_count: 100,
  completed_count: 90,
  incident_count: 2,
  incident_rate_pct: 2,
  element_incident_count: null,
  element_incident_rate_pct: null,
  avg_duration_sec: 10,
  p95_duration_sec: 20,
  ...over,
})

const versionCompare = (
  kpis: VersionCompareKpi[],
  engines: string[] | null = ["prod-a"],
): VersionCompareResult => ({
  engines,
  processDefinitionKey: "order",
  versionA: 1,
  versionB: 2,
  windowDays: 14,
  minBucketSize: 10,
  suppressed: false,
  kpis,
  delta: {
    started_per_day_delta_pct: 0,
    incident_rate_delta_pp: 0,
    element_incident_rate_delta_pp: null,
    avg_duration_delta_pct: 25,
    p95_duration_delta_pct: null,
  },
})

describe("describeVersionCompare", () => {
  it("names the measured deltas, the incident rate per version included", () => {
    const text = describeVersionCompare(versionCompare([versionKpi(1), versionKpi(2)]), {})

    expect(text).toContain("avgDurationDeltaPct=25")
    expect(text).toContain("incidentRateDeltaPp=0")
    expect(text).toContain('largestDelta="avgDurationDeltaPct"')
    // An unmeasured delta is left out — never sent as 0.
    expect(text).not.toContain("p95DurationDeltaPct")
    expect(text).not.toMatch(/failure/i)
  })

  // The tool takes no element scope (#336).
  it("re-runs the process-wide comparison on the engines on screen", () => {
    const text = describeVersionCompare(versionCompare([versionKpi(1), versionKpi(2)]), {})
    expect(text).toContain(
      'Ids: engine="prod-a", processDefinitionKey="order", versionA=1, versionB=2, windowDays=14\n',
    )
    expect(text).toContain("every figure covers the whole process")
    expect(text).not.toContain("activityId")
  })

  it("names every engine of a fleet comparison (K33)", () => {
    const text = describeVersionCompare(
      versionCompare([versionKpi(1), versionKpi(2)], ["prod-a", "prod-b"]),
      {},
    )
    expect(text).toContain('Ids: engine=["prod-a","prod-b"]')
    expect(text).toContain("(aggregated)")
  })
})

const failures = (engines: string[] | null): FailureDashboardData => ({
  engines,
  totalIncidents: 6,
  uniqueErrorPatterns: 1,
  mostAffectedProcess: "order",
  errorPatterns: [{ incidentType: "failedJob", processDefinitionKey: "order", incidentCount: 6 }],
  processBreakdown: [
    {
      processDefinitionKey: "order",
      runningNow: 50,
      deadJobs: 3,
      openIncidents: 6,
      incidentRatePct: 12,
    },
  ],
})

describe("describeFailureRates", () => {
  it("states live open incidents per running instance and routes the regression check (#327)", () => {
    const text = describeFailureRates(failures(["prod-a"]), {})

    expect(text).toContain('Ids: engine="prod-a"\n')
    expect(text).toContain(
      'highestRateProcessDefinitionKey="order", highestOpenIncidentsNow=6, highestRunningNow=50, highestIncidentRatePct=12, highestDeadJobs=3',
    )
    expect(text).toContain("Tools: analytics_compare_execution_periods, analytics_cluster_compare")
    // Its incident rates are null per version — a wasted call for this question.
    expect(text).not.toContain("analytics_version_compare")
    // Incidents, not failed instances (N85).
    expect(text).not.toMatch(/failed|failure/i)
  })

  it("leaves an unmeasured rate out instead of sending it as 0", () => {
    const idle = failures(["prod-a"])
    idle.processBreakdown = [{ ...idle.processBreakdown[0], runningNow: 0, incidentRatePct: null }]
    expect(describeFailureRates(idle, {})).not.toContain("highestIncidentRatePct")
  })
})

describe("failure-dashboard scope (N83/N116)", () => {
  it("names the engines from the data, not from cell props — a self-fetch keeps its label", () => {
    for (const describeCell of [
      describeFailureSummary,
      describeErrorPatterns,
      describeFailureRates,
    ]) {
      const fleet = describeCell(failures(["prod-a", "prod-b"]), {})
      expect(fleet).toContain('Ids: engine=["prod-a","prod-b"]')
      expect(fleet).toContain("(aggregated)")
      // Props claiming another engine never override what the data covers.
      const scoped = describeCell(failures(["prod-a"]), { engine: "prod-b" })
      expect(scoped).toContain('Ids: engine="prod-a"')
      expect(scoped).not.toContain("prod-b")
      // An unscoped library result names no engine — never a placeholder.
      expect(describeCell(failures(null), {})).not.toContain("engine=")
    }
  })

  it("presents only fields the open-incident metric fills (N117)", () => {
    const text = describeErrorPatterns(failures(["prod-a"]), {})
    expect(text).toContain(
      'On screen: groups=1, largestGroupProcessDefinitionKey="order", largestGroupIncidentType="failedJob", largestGroupIncidents=6',
    )
    expect(text).toContain("no message, activity or timestamps")
  })

  // The largest group's key is a fact, never a scope; the list is capped at 50, the totals not.
  it("scopes the view by engine only and states the exact group count of a capped list", () => {
    const capped: FailureDashboardData = {
      ...failures(["prod-a", "prod-b"]),
      uniqueErrorPatterns: 73,
      errorPatterns: Array.from({ length: 50 }, (_, i) => ({
        incidentType: "failedJob",
        processDefinitionKey: i === 0 ? "order" : `process_${i}`,
        incidentCount: 100 - i,
      })),
    }
    const text = describeErrorPatterns(capped, {})
    expect(text).toContain('Ids: engine=["prod-a","prod-b"]\n')
    expect(text).not.toMatch(/[,\s]processDefinitionKey=/)
    expect(text).toContain(
      'On screen: groups=73, listedGroups=50, largestGroupProcessDefinitionKey="order", largestGroupIncidentType="failedJob", largestGroupIncidents=100',
    )
    // An uncapped list is the whole set — no listed count beside it.
    expect(describeErrorPatterns(failures(["prod-a"]), {})).not.toContain("listedGroups")
  })
})
