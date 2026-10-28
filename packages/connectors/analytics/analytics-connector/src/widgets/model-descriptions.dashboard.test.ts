import { describe, expect, it } from "vitest"
import type { AnalyticsDashboardData, CompareKpiDelta } from "@miragon/pulse-analytics-client"
import type { AnalyticsBpmnHeatmapData } from "./bpmn-heatmap.js"
import {
  describeActivityBottlenecks,
  describeBpmnHeatmap,
  describeClusterCompare,
  describeDefinitionBreakdown,
  describeEngineCompare,
  describeExecutionPerformance,
  describeExecutionSummary,
} from "./model-descriptions.js"

const dashboard = (over: Partial<AnalyticsDashboardData> = {}): AnalyticsDashboardData => ({
  processDefinitionKey: null,
  period: "7d",
  engines: ["prod-a", "prod-b"],
  totalCount: 40,
  completedCount: 30,
  incidentsCreated: 5,
  incidentsResolved: 2,
  incidentRatePct: 12.5,
  avgDurationMs: 60_000,
  medianDurationMs: 45_000,
  p95DurationMs: 187_000,
  runningNow: 156,
  openIncidentsNow: 12,
  previous: null,
  activityBreakdown: [],
  activityCount: 0,
  definitionBreakdown: [
    {
      processDefinitionKey: "order",
      totalInstances: 30,
      completed: 25,
      runningNow: 100,
      incidentsCreated: 4,
      avgDurationMs: 1,
    },
    {
      processDefinitionKey: "refund",
      totalInstances: 10,
      completed: 5,
      runningNow: null,
      incidentsCreated: 1,
      avgDurationMs: 2,
    },
  ],
  ...over,
})

describe("dashboard model descriptions", () => {
  it("labels the fleet aggregate with its engines and the period it covers (K33)", () => {
    const text = describeExecutionSummary(dashboard(), {})
    expect(text).toContain('Ids: engine=["prod-a","prod-b"], period="7d"\n')
    expect(text).toContain("(aggregated)")
    expect(text).toContain(
      "Tools: analytics_analyze_process_performance, analytics_find_failed_instances",
    )
  })

  it("reads the scope from the data, never from the cell props", () => {
    const text = describeExecutionSummary(
      dashboard({ processDefinitionKey: "order", engines: ["prod-a"], period: "1d" }),
      { engine: "prod-b", period: "30d" },
    )
    expect(text).toContain('Ids: engine="prod-a", processDefinitionKey="order", period="1d"\n')
    expect(text).not.toContain("prod-b")
    // Scoped to one process: no definition count.
    expect(text).not.toContain("processDefinitions=")
  })

  it("keeps window flows and the live gauges apart (N77)", () => {
    const text = describeExecutionSummary(dashboard(), {})
    expect(text).toContain(
      "processDefinitions=2, startedInWindow=40, completedInWindow=30, incidentsCreatedInWindow=5, incidentsResolvedInWindow=2, runningNow=156, openIncidentsNow=12",
    )
    expect(text).toContain("incidents, not failed instances")
  })

  it("never reads an unreported gauge or an empty duration window as 0 (N78)", () => {
    const text = describeExecutionSummary(
      dashboard({ runningNow: null, openIncidentsNow: null }),
      {},
    )
    expect(text).not.toMatch(/runningNow|openIncidentsNow/)
    const perf = describeExecutionPerformance(
      dashboard({
        avgDurationMs: null,
        medianDurationMs: null,
        p95DurationMs: null,
        incidentRatePct: null,
      }),
      {},
    )
    expect(perf).toContain("No instance ended in the period")
    expect(perf).not.toMatch(/DurationMs|incidentRatePct/)
    expect(describeExecutionPerformance(dashboard(), {})).toContain(
      "avgDurationMs=60000, medianDurationMs=45000, p95DurationMs=187000, incidentRatePct=12.5",
    )
  })

  it("states the previous period's rate the screen judges against, and when it is noise", () => {
    const previous = {
      totalCount: 30,
      incidentsCreated: 2,
      incidentRatePct: 6.7,
      partial: false,
      suppressed: false,
    }
    const scoped = { processDefinitionKey: "order" }
    const text = describeExecutionPerformance(dashboard({ ...scoped, previous }), {})
    expect(text).toContain("incidentRatePct=12.5, previousPeriodIncidentRatePct=6.7")
    expect(text).not.toContain("NotReliable")
    expect(text).not.toContain("mix")
    const noisy = describeExecutionPerformance(
      dashboard({ ...scoped, previous: { ...previous, suppressed: true } }),
      {},
    )
    expect(noisy).toContain("previousPeriodComparisonNotReliable=true")
  })

  // Simpson's paradox: a rate over several processes moves with their mix.
  it("says a rate over several processes is not judged against the previous period", () => {
    const previous = {
      totalCount: 30,
      incidentsCreated: 2,
      incidentRatePct: 6.7,
      partial: false,
      suppressed: true,
    }
    const text = describeExecutionPerformance(dashboard({ previous }), {})
    expect(text).toContain("reflects their mix and is not judged")
    expect(text).toContain("previousPeriodIncidentRatePct=6.7")
    expect(text).not.toContain("NotReliable")
  })

  it("names the busiest definition with its window flows and live state", () => {
    const text = describeDefinitionBreakdown(dashboard(), {})
    expect(text).toContain(
      'busiestProcessDefinitionKey="order", busiestStartedInWindow=30, busiestIncidentsCreatedInWindow=4, busiestRunningNow=100',
    )
    expect(text).toContain("Tools: analytics_show_dashboard")
  })

  it("names the process of the top activity — ids repeat across models (N84)", () => {
    const text = describeActivityBottlenecks(
      dashboard({
        activityBreakdown: [
          {
            processDefinitionKey: "invoice",
            activityId: "StartEvent_1",
            activityType: "startEvent",
            executionCount: 9,
            avgDurationMs: 10,
            p95DurationMs: 20,
            totalTimeMs: 90,
          },
        ],
      }),
      {},
    )
    expect(text).toContain('topProcessDefinitionKey="invoice", topActivityId="StartEvent_1"')
    expect(text).toContain('Ids: engine=["prod-a","prod-b"], period="7d"')
    // The whole breakdown is on screen: no "in all" count.
    expect(text).not.toContain("activitiesInAll")
  })

  it("says a cut list is the top of more activities", () => {
    const row = {
      processDefinitionKey: "invoice",
      activityId: "Task_A",
      activityType: "userTask",
      executionCount: 9,
      avgDurationMs: 10,
      p95DurationMs: 20,
      totalTimeMs: 90,
    }
    const text = describeActivityBottlenecks(
      dashboard({ activityBreakdown: [row], activityCount: 37 }),
      {},
    )
    expect(text).toContain("rows=1, activitiesInAll=37")
  })
})

const delta: CompareKpiDelta = {
  started_per_day_delta_pct: 5,
  incident_rate_delta_pp: -1.5,
  element_incident_rate_delta_pp: null,
  avg_duration_delta_pct: 0,
  p95_duration_delta_pct: null,
}

describe("the comparison descriptions", () => {
  it("cluster compare: re-runs as asked, states the windows as measured", () => {
    const text = describeClusterCompare(
      {
        engines: ["prod-a"],
        processDefinitionKey: null,
        activityId: null,
        deploymentTimestamp: "2026-07-01T12:00:00Z",
        requestedWindowDays: { before: 7, after: 7 },
        windowDays: { before: 7, after: 0.42 },
        partial: true,
        minBucketSize: 10,
        suppressed: true,
        kpis: [],
        delta,
      },
      {},
    )
    // The tool takes whole days: the requested windows, never the measured 0.42.
    expect(text).toContain(
      'Ids: engine="prod-a", deploymentTimestamp="2026-07-01T12:00:00Z", windowBeforeDays=7, windowAfterDays=7\n',
    )
    expect(text).toContain("measuredBeforeDays=7, measuredAfterDays=0.42")
    expect(text).toContain("starts compare per day")
    expect(text).toContain('largestDelta="startedPerDayDeltaPct"')
    expect(text).toContain("suppressed=true")
    expect(text).toContain("treat the deltas as noise")
    expect(text).not.toMatch(/failure/i)
  })

  it("engine compare: the process is held fixed", () => {
    const text = describeEngineCompare(
      {
        engineA: "prod-a",
        engineB: "prod-b",
        processDefinitionKey: "order",
        windowDays: 14,
        activityId: null,
        minBucketSize: 10,
        suppressed: false,
        kpis: [],
        delta,
      },
      {},
    )
    expect(text).toContain(
      'Ids: processDefinitionKey="order", engineA="prod-a", engineB="prod-b", windowDays=14',
    )
    expect(text).toContain("attributable to the engine")
    expect(text).not.toContain("noise")
  })
})

describe("describeBpmnHeatmap", () => {
  const heatmap = (engines: string[]): AnalyticsBpmnHeatmapData => ({
    processDefinitionKey: "order",
    period: "7d",
    engines,
    frequency: { Task_A: 12, Task_B: 4 },
    durationSec: { Task_A: 1.04, Task_B: 9.26 },
  })

  it("names the engines whose heat it adds up (K33)", () => {
    const fleet = describeBpmnHeatmap(heatmap(["prod-a", "prod-b"]), {})
    expect(fleet).toContain(
      'Ids: engine=["prod-a","prod-b"], processDefinitionKey="order", period="7d"',
    )
    expect(fleet).toContain("(aggregated)")
    expect(describeBpmnHeatmap(heatmap(["prod-b"]), {})).toContain(
      'Ids: engine="prod-b", processDefinitionKey="order", period="7d"',
    )
  })

  it("the hottest and slowest element as facts", () => {
    const text = describeBpmnHeatmap(heatmap(["prod-a"]), {})
    expect(text).toContain('hottestActivityId="Task_A", hottestExecutions=12')
    expect(text).toContain('slowestActivityId="Task_B", slowestAvgSec=9.3')
    expect(text).toContain("Tools: analytics_element_bottleneck")
  })
})
