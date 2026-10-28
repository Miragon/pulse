import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ACTIVITY_BREAKDOWN_LIMIT, dashboardData, failureDashboardData } from "./dashboard.js"
import type { PrometheusClient, PromSample } from "../prometheus.js"

const v = (value: number): PromSample => ({ metric: {}, value })
const def = (key: string, value: number): PromSample => ({
  metric: { process_definition_key: key },
  value,
})
const act = (key: string, id: string, value: number, type?: string): PromSample => ({
  metric: {
    process_definition_key: key,
    activity_id: id,
    ...(type ? { activity_type: type } : {}),
  },
  value,
})

const BY_KEY = "by (process_definition_key)"

/**
 * Ordered dispatch table for the mock client (durations in seconds; the mock
 * answers them in ms, the histogram's unit): first predicate match wins, so
 * the specific rules (activity-level, then definition-level breakdowns, then
 * the live gauges) sit before the global-KPI fallbacks.
 */
const CANNED_SAMPLES: Array<[(q: string) => boolean, PromSample[]]> = [
  // Activity-level breakdowns — `StartEvent_1` exists in two processes.
  [
    (q) => q.includes("camunda_activity_ended_total"),
    [
      act("order", "Task_A", 10, "serviceTask"),
      act("order", "Task_B", 5, "userTask"),
      act("order", "StartEvent_1", 60, "startEvent"),
      act("invoice", "StartEvent_1", 40, "startEvent"),
    ],
  ],
  [
    (q) => q.includes("camunda_activity_duration_milliseconds_sum"),
    [act("order", "Task_A", 100), act("order", "Task_B", 20), act("invoice", "StartEvent_1", 4)],
  ],
  [(q) => q.includes("activity_id, le"), [act("order", "Task_A", 15), act("order", "Task_B", 6)]],
  [(q) => q.includes(BY_KEY) && q.includes("incident_created"), [def("order", 6)]],
  [
    (q) => q.includes(BY_KEY) && q.includes('state="COMPLETED"'),
    [def("order", 50), def("invoice", 20)],
  ],
  [
    (q) => q.includes(BY_KEY) && q.includes("started_total"),
    [def("order", 60), def("invoice", 40)],
  ],
  [
    (q) => q.includes(BY_KEY) && q.includes("duration_milliseconds_sum"),
    [def("order", 600), def("invoice", 80)],
  ],
  [
    (q) => q.includes(BY_KEY) && q.includes("duration_milliseconds_count"),
    [def("order", 50), def("invoice", 20)],
  ],
  // A long-running process with no start in the window still runs NOW.
  [
    (q) => q.includes(BY_KEY) && q.includes("process_instances_running"),
    [def("order", 120), def("invoice", 30), def("longRunning", 6)],
  ],
  [(q) => q.includes("process_instances_running"), [v(156)]],
  [(q) => q.includes("incidents_open"), [v(12)]],
  // The engine-state presence probe: the engine in scope reports.
  [(q) => q.includes("camunda_jobs_executable"), [{ metric: { engine_id: "prod-a" }, value: 3 }]],
  [(q) => q.includes("histogram_quantile(0.5"), [v(8)]],
  [(q) => q.includes("histogram_quantile(0.95"), [v(30)]],
  [(q) => q.includes("incident_resolved"), [v(4)]],
  [(q) => q.includes("incident_created"), [v(10)]],
  [(q) => q.includes('state="COMPLETED"'), [v(70)]],
  [(q) => q.includes("started_total"), [v(100)]],
  [(q) => q.includes("duration_milliseconds_sum"), [v(12)]], // avg = sum/count expression
]

function mockClient() {
  const instant = vi.fn(async (q: string): Promise<PromSample[]> => {
    const hit = CANNED_SAMPLES.find(([matches]) => matches(q))
    const ms = /duration_milliseconds_sum|histogram_quantile/.test(q) ? 1000 : 1
    return hit ? hit[1].map((s) => ({ ...s, value: s.value * ms })) : []
  })
  const ch: PrometheusClient = { instant }
  return { ch, instant }
}

describe("dashboardData", () => {
  it("separates window flows from the live state and echoes its scope", async () => {
    const { ch } = mockClient()
    const res = await dashboardData(ch, { period: "7d", engine: ["prod-a", "prod-b"] })

    expect(res).toMatchObject({
      processDefinitionKey: null,
      period: "7d",
      engines: ["prod-a", "prod-b"],
      totalCount: 100,
      completedCount: 70,
      incidentsCreated: 10,
      incidentsResolved: 4,
      incidentRatePct: 10,
      avgDurationMs: 12000,
      medianDurationMs: 8000,
      p95DurationMs: 30000,
      // Live gauges — NOT started − ended (would be 30) nor created − resolved (6)
      runningNow: 156,
      openIncidentsNow: 12,
    })
  })

  it("groups the activity breakdown by (process, activity) — ids repeat across models (N84)", async () => {
    const { ch } = mockClient()
    const res = await dashboardData(ch, { period: "7d" })

    expect(res.activityBreakdown).toEqual([
      {
        processDefinitionKey: "order",
        activityId: "Task_A",
        activityType: "serviceTask",
        executionCount: 10,
        avgDurationMs: 10000,
        p95DurationMs: 15000,
        totalTimeMs: 100000,
      },
      {
        processDefinitionKey: "order",
        activityId: "Task_B",
        activityType: "userTask",
        executionCount: 5,
        avgDurationMs: 4000,
        p95DurationMs: 6000,
        totalTimeMs: 20000,
      },
      {
        processDefinitionKey: "invoice",
        activityId: "StartEvent_1",
        activityType: "startEvent",
        executionCount: 40,
        avgDurationMs: 100,
        p95DurationMs: null,
        totalTimeMs: 4000,
      },
      {
        // Executions but no duration series: unmeasured, not 0 ms.
        processDefinitionKey: "order",
        activityId: "StartEvent_1",
        activityType: "startEvent",
        executionCount: 60,
        avgDurationMs: null,
        p95DurationMs: null,
        totalTimeMs: 0,
      },
    ])
  })

  it("reads the per-definition running count from the live gauge, keeping long-running keys", async () => {
    const { ch } = mockClient()
    const res = await dashboardData(ch, { period: "7d" })

    expect(res.definitionBreakdown).toEqual([
      {
        processDefinitionKey: "order",
        totalInstances: 60,
        completed: 50,
        runningNow: 120,
        incidentsCreated: 6,
        avgDurationMs: 12000,
      },
      {
        processDefinitionKey: "invoice",
        totalInstances: 40,
        completed: 20,
        runningNow: 30,
        incidentsCreated: 0,
        avgDurationMs: 4000,
      },
      {
        processDefinitionKey: "longRunning",
        totalInstances: 0,
        completed: 0,
        runningNow: 6,
        incidentsCreated: 0,
        avgDurationMs: null,
      },
    ])
  })

  it("reports durations, rates and the live state as unmeasured when no samples exist", async () => {
    const instant = vi.fn(async (): Promise<PromSample[]> => [])
    const res = await dashboardData({ instant }, { period: "1d" })

    expect(res).toMatchObject({
      totalCount: 0,
      incidentRatePct: null,
      avgDurationMs: null,
      medianDurationMs: null,
      p95DurationMs: null,
      runningNow: null,
      openIncidentsNow: null,
      engines: null,
      activityBreakdown: [],
      definitionBreakdown: [],
    })
  })

  it("reads a reporting engine's missing gauge series as a measured 0, not as unreported", async () => {
    // The metrics plugin registers an open-incident row only per (key, type)
    // that HAS incidents, and a running row only per deployed key — so a
    // healthy engine with nothing open sends no camunda_incidents_open series
    // at all. Its presence probe still answers: that is a 0, the same 0 the
    // failure dashboard and engine health report.
    const instant = vi.fn(async (q: string): Promise<PromSample[]> =>
      q.includes("camunda_jobs_executable")
        ? [{ metric: { engine_id: "prod-a" }, value: 0 }]
        : q ===
            'sum(max by (process_definition_key, engine_id)(camunda_process_instances_running{engine_id="prod-a"}))'
          ? [v(156)]
          : [],
    )
    const res = await dashboardData({ instant }, { period: "1d", engine: "prod-a" })

    expect(res).toMatchObject({ runningNow: 156, openIncidentsNow: 0 })

    // A process the engine does not run: nothing running, nothing open — both 0.
    const scoped = await dashboardData(
      { instant },
      { processDefinitionKey: "gone", period: "1d", engine: "prod-a" },
    )
    expect(scoped).toMatchObject({ runningNow: 0, openIncidentsNow: 0 })
  })

  it("keeps a definition's running count measured when only its gauge row is missing", async () => {
    // A key that started work in the window but has no running row: 0
    // running while the engine reports, never "not reported".
    const instant = vi.fn(async (q: string): Promise<PromSample[]> =>
      q.includes("camunda_jobs_executable")
        ? [{ metric: { engine_id: "prod-a" }, value: 0 }]
        : q.includes(BY_KEY) && q.includes("started_total")
          ? [def("order", 5)]
          : [],
    )
    const res = await dashboardData({ instant }, { period: "1d", engine: "prod-a" })

    expect(res.definitionBreakdown).toMatchObject([
      { processDefinitionKey: "order", runningNow: 0 },
    ])
  })

  it("lets an incident rate exceed 100 % rather than capping it — incidents are not instances", async () => {
    const instant = vi.fn(async (q: string): Promise<PromSample[]> =>
      q.includes("incident_created") ? [v(30)] : q.includes("started_total") ? [v(10)] : [],
    )
    const res = await dashboardData({ instant }, { period: "1d" })
    expect(res.incidentRatePct).toBe(300)
  })

  it("scopes every query to the definition key and engine filter, every flow to the period", async () => {
    const { ch, instant } = mockClient()
    await dashboardData(ch, {
      processDefinitionKey: "myKey",
      period: "30d",
      engine: "prod-a",
    })

    const queries = instant.mock.calls.map((c) => c[0])
    expect(queries.length).toBeGreaterThan(0)
    expect(queries.every((q) => q.includes('engine_id="prod-a"'))).toBe(true)
    // The presence probe asks whether the ENGINE reports — its gauge carries
    // engine_id only; every other query is scoped to the process.
    const probe = 'max by (engine_id)(camunda_jobs_executable{engine_id="prod-a"})'
    expect(queries.filter((q) => q === probe)).toHaveLength(1)
    expect(
      queries.filter((q) => q !== probe).every((q) => q.includes('process_definition_key="myKey"')),
    ).toBe(true)
    // The live gauges are point-in-time (no range at all), each node-folded.
    const gauges = queries.filter((q) => !q.includes("increase("))
    expect(gauges).toEqual([
      'sum(max by (process_definition_key, engine_id)(camunda_process_instances_running{process_definition_key="myKey",engine_id="prod-a"}))',
      'sum(max by (process_definition_key, incident_type, engine_id)(camunda_incidents_open{process_definition_key="myKey",engine_id="prod-a"}))',
      'sum by (process_definition_key)(max by (process_definition_key, engine_id)(camunda_process_instances_running{process_definition_key="myKey",engine_id="prod-a"}))',
      probe,
    ])
    const flows = queries.filter((q) => q.includes("increase("))
    expect(flows.every((q) => q.includes("[30d]"))).toBe(true)
  })
})

describe("dashboardData — the top list and the previous period", () => {
  const NOW = Date.parse("2026-10-09T12:00:00Z")
  const NOW_SECONDS = NOW / 1000
  const WEEK = 7 * 86_400

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** Starts and incidents per window: the period (`[7d]`) and the one before it (`@`). */
  function windowClient(current: [number, number], previous: [number, number]) {
    return vi.fn((q: string): Promise<PromSample[]> => {
      const [started, incidents] = q.includes(" @ ") ? previous : current
      if (q.includes("by (")) return Promise.resolve([])
      if (q.includes("incident_created")) return Promise.resolve([v(incidents)])
      if (q.includes("started_total")) return Promise.resolve([v(started)])
      return Promise.resolve([])
    })
  }

  it("reads the same flows over the window right before the period", async () => {
    const instant = windowClient([200, 8], [180, 3])
    const res = await dashboardData({ instant }, { period: "7d" })

    expect(res.incidentRatePct).toBe(4)
    expect(res.previous).toEqual({
      totalCount: 180,
      incidentsCreated: 3,
      incidentRatePct: 1.7,
      partial: false,
      suppressed: false,
    })
    // The previous window ends where the period starts and is just as long.
    const previous = instant.mock.calls.map((c) => c[0]).filter((q) => q.includes(" @ "))
    expect(previous).toHaveLength(2)
    for (const q of previous) {
      expect(q).toContain(`[${WEEK}s] @ ${NOW_SECONDS - WEEK}`)
    }
  })

  it("does not judge a rate over fewer starts than the comparison floor", async () => {
    const res = await dashboardData(
      { instant: windowClient([200, 8], [9, 3]) },
      { period: "7d", minBucketSize: 10 },
    )
    expect(res.previous).toMatchObject({ totalCount: 9, suppressed: true })

    const floor = await dashboardData(
      { instant: windowClient([200, 8], [9, 3]) },
      { period: "7d", minBucketSize: 5 },
    )
    expect(floor.previous?.suppressed).toBe(false)
  })

  it("reads no previous window that lies wholly before the retention", async () => {
    // 14 days back from 14 days ago: still inside the 30-day retention.
    const inside = await dashboardData({ instant: windowClient([1, 0], [1, 0]) }, { period: "14d" })
    expect(inside.previous?.partial).toBe(false)
    // 30 days back from 30 days ago: wholly before the retention, no figures exist.
    const instant = windowClient([1, 0], [1, 0])
    const outside = await dashboardData({ instant }, { period: "30d" })
    expect(outside.previous).toBeNull()
    expect(instant.mock.calls.some((c) => c[0].includes(" @ "))).toBe(false)
  })

  it("keeps the top 20 activities by total time and says how many there were", async () => {
    const rows = Array.from({ length: 23 }, (_, i) => act("order", `Task_${i}`, 1, "serviceTask"))
    const sums = rows.map((r, i) => ({ ...r, value: (i + 1) * 1000 }))
    const instant = vi.fn((q: string): Promise<PromSample[]> => {
      if (q.includes("camunda_activity_ended_total")) return Promise.resolve(rows)
      if (q.includes("camunda_activity_duration_milliseconds_sum")) return Promise.resolve(sums)
      return Promise.resolve([])
    })
    const res = await dashboardData({ instant }, { period: "7d" })

    expect(ACTIVITY_BREAKDOWN_LIMIT).toBe(20)
    expect(res.activityCount).toBe(23)
    expect(res.activityBreakdown).toHaveLength(20)
    expect(res.activityBreakdown[0]).toMatchObject({ activityId: "Task_22", totalTimeMs: 23_000 })
    expect(res.activityBreakdown[19]).toMatchObject({ activityId: "Task_3" })
  })
})

describe("failureDashboardData", () => {
  it("builds incident groups and the per-process breakdown from the live gauges", async () => {
    const instant = vi.fn(async (q: string): Promise<PromSample[]> => {
      if (q.includes("sum by (process_definition_key, incident_type)")) {
        return [
          {
            metric: { process_definition_key: "order", incident_type: "failedJob" },
            value: 7,
          },
          {
            metric: { process_definition_key: "invoice", incident_type: "failedExternalTask" },
            value: 2,
          },
          { metric: { process_definition_key: "order", incident_type: "noise" }, value: 0 },
        ]
      }
      if (q.includes("camunda_incidents_open")) {
        return [
          { metric: { process_definition_key: "order" }, value: 7 },
          { metric: { process_definition_key: "invoice" }, value: 2 },
          { metric: { process_definition_key: "stuck" }, value: 1 },
        ]
      }
      if (q.includes("camunda_jobs_failed")) {
        return [{ metric: { process_definition_key: "order" }, value: 3 }]
      }
      return [
        { metric: { process_definition_key: "order" }, value: 70 },
        { metric: { process_definition_key: "invoice" }, value: 10 },
      ]
    })

    const res = await failureDashboardData({ instant }, { engine: "prod-a" })

    expect(res.engines).toEqual(["prod-a"])
    expect(res.totalIncidents).toBe(9)
    expect(res.uniqueErrorPatterns).toBe(2)
    expect(res.mostAffectedProcess).toBe("order")
    // Only what the gauge carries — no activity, timestamps or sample ids.
    expect(res.errorPatterns).toEqual([
      { incidentType: "failedJob", processDefinitionKey: "order", incidentCount: 7 },
      { incidentType: "failedExternalTask", processDefinitionKey: "invoice", incidentCount: 2 },
    ])
    expect(res.processBreakdown).toEqual([
      {
        processDefinitionKey: "order",
        runningNow: 70,
        deadJobs: 3,
        openIncidents: 7,
        incidentRatePct: 10,
      },
      {
        processDefinitionKey: "invoice",
        runningNow: 10,
        deadJobs: 0,
        openIncidents: 2,
        incidentRatePct: 20,
      },
      {
        // Open incidents but nothing running reported: a rate of nothing is unmeasured.
        processDefinitionKey: "stuck",
        runningNow: 0,
        deadJobs: 0,
        openIncidents: 1,
        incidentRatePct: null,
      },
    ])
  })

  it("computes totals over ALL patterns while capping the list at the top 50", async () => {
    // 60 distinct patterns, counts 60..1 — the KPI must not stop at the cap.
    const instant = vi.fn(async (q: string): Promise<PromSample[]> => {
      if (q.includes("sum by (process_definition_key, incident_type)")) {
        return Array.from({ length: 60 }, (_, i) => ({
          metric: { process_definition_key: `proc-${i}`, incident_type: `type-${i}` },
          value: 60 - i,
        }))
      }
      return []
    })

    const res = await failureDashboardData({ instant }, {})

    expect(res.engines).toBeNull()
    expect(res.errorPatterns).toHaveLength(50)
    expect(res.uniqueErrorPatterns).toBe(60)
    // 60+59+…+1 = 1830, including the 10 sliced-off tail patterns.
    expect(res.totalIncidents).toBe(1830)
    expect(res.errorPatterns[0].incidentCount).toBe(60)
  })
})
