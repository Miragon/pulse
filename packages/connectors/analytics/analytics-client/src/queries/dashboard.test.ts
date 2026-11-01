import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { dashboardData } from "./dashboard.js"
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
  // Only Task_A's buckets moved enough for a median.
  [
    (q) => q.includes("histogram_quantile(0.5, sum by (process_definition_key, activity_id, le)"),
    [act("order", "Task_A", 9)],
  ],
  [(q) => q.includes("activity_id, le"), [act("order", "Task_A", 15), act("order", "Task_B", 6)]],
  [
    (q) =>
      q.includes("by (process_definition_key, activity_id)(") && q.includes("incident_created"),
    [act("order", "Task_A", 3)],
  ],
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
      startedCount: 100,
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
        medianDurationMs: 9000,
        p95DurationMs: 15000,
        totalTimeMs: 100000,
        incidentsCreated: 3,
      },
      {
        processDefinitionKey: "order",
        activityId: "Task_B",
        activityType: "userTask",
        executionCount: 5,
        avgDurationMs: 4000,
        medianDurationMs: null,
        p95DurationMs: 6000,
        totalTimeMs: 20000,
        incidentsCreated: 0,
      },
      {
        processDefinitionKey: "invoice",
        activityId: "StartEvent_1",
        activityType: "startEvent",
        executionCount: 40,
        avgDurationMs: 100,
        medianDurationMs: null,
        p95DurationMs: null,
        totalTimeMs: 4000,
        incidentsCreated: 0,
      },
      {
        // Executions but no duration series: unmeasured, not 0 ms.
        processDefinitionKey: "order",
        activityId: "StartEvent_1",
        activityType: "startEvent",
        executionCount: 60,
        avgDurationMs: null,
        medianDurationMs: null,
        p95DurationMs: null,
        totalTimeMs: 0,
        incidentsCreated: 0,
      },
    ])
  })

  it("reads the per-definition running count from the live gauge, keeping long-running keys", async () => {
    const { ch } = mockClient()
    const res = await dashboardData(ch, { period: "7d" })

    expect(res.definitionBreakdown).toEqual([
      {
        processDefinitionKey: "order",
        startedCount: 60,
        completedCount: 50,
        runningNow: 120,
        incidentsCreated: 6,
        avgDurationMs: 12000,
      },
      {
        processDefinitionKey: "invoice",
        startedCount: 40,
        completedCount: 20,
        runningNow: 30,
        incidentsCreated: 0,
        avgDurationMs: 4000,
      },
      {
        processDefinitionKey: "longRunning",
        startedCount: 0,
        completedCount: 0,
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
      startedCount: 0,
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
    // at all. Its presence probe still answers: that is a 0, the same 0 engine
    // health and the landscape report.
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

describe("dashboardData: the previous period", () => {
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
      startedCount: 180,
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

  it("does not judge a rate over fewer starts than the comparison floor of 10", async () => {
    const before = await dashboardData(
      { instant: windowClient([200, 8], [9, 3]) },
      { period: "7d" },
    )
    expect(before.previous).toMatchObject({ startedCount: 9, suppressed: true })
    const now = await dashboardData({ instant: windowClient([9, 3], [200, 8]) }, { period: "7d" })
    expect(now.previous).toMatchObject({ startedCount: 200, suppressed: true })

    const atFloor = await dashboardData(
      { instant: windowClient([10, 1], [10, 3]) },
      { period: "7d" },
    )
    expect(atFloor.previous?.suppressed).toBe(false)
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
})
