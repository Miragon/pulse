import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { analyzePerformance, comparePeriods } from "./performance.js"
import type { PrometheusClient, PromSample } from "../prometheus.js"

const v = (value: number): PromSample => ({ metric: {}, value })

function mockClient() {
  const instant = vi.fn(async (q: string): Promise<PromSample[]> => {
    if (q.includes("camunda_activity_ended_total")) {
      return [
        { metric: { activity_id: "A", activity_type: "serviceTask" }, value: 10 },
        { metric: { activity_id: "B", activity_type: "userTask" }, value: 4 },
      ]
    }
    if (q.includes("camunda_activity_duration_milliseconds_sum")) {
      return [
        { metric: { activity_id: "A" }, value: 100_000 },
        { metric: { activity_id: "B" }, value: 10_000 },
      ]
    }
    if (q.includes("histogram_quantile(0.5, sum by (activity_id, le)")) {
      // B's buckets did not move: no median for it.
      return [{ metric: { activity_id: "A" }, value: 9_000 }]
    }
    if (q.includes("activity_id, le")) {
      return [
        { metric: { activity_id: "A" }, value: 15_000 },
        { metric: { activity_id: "B" }, value: 5_000 },
      ]
    }
    if (q.includes("histogram_quantile(0.5")) return [v(8_000)]
    if (q.includes("histogram_quantile(0.95")) return [v(20_000)]
    if (q.includes("incident_created")) return [v(5)]
    if (q.includes('state="COMPLETED"')) return [v(40)]
    if (q.includes("started_total")) return [v(50)]
    if (q.includes("duration_milliseconds_sum")) return [v(10_040)] // avg = sum/count expression
    return []
  })
  const ch: PrometheusClient = { instant }
  return { ch, instant }
}

describe("analyzePerformance", () => {
  it("maps counts, incidents and rounded durations into the KPI", async () => {
    const { ch } = mockClient()
    const res = await analyzePerformance(ch, {
      processDefinitionKey: "order",
      period: "7d",
      includeActivityBreakdown: true,
    })

    expect(res.kpi).toEqual({
      process_definition_key: "order",
      total_instances: 50,
      completed: 40,
      incident_count: 5,
      incident_rate_pct: 10,
      avg_duration_sec: 10, // 10.04 rounded to one decimal
      median_duration_sec: 8,
      p95_duration_sec: 20,
    })

    // Ranked by total time; names degrade to null on metrics; the median is
    // computed from the histogram, null where the buckets did not move.
    expect(res.activityBreakdown).toEqual([
      {
        activity_id: "A",
        activity_name: null,
        activity_type: "serviceTask",
        execution_count: 10,
        avg_duration_sec: 10,
        median_duration_sec: 9,
        p95_duration_sec: 15,
        total_time_sec: 100,
      },
      {
        activity_id: "B",
        activity_name: null,
        activity_type: "userTask",
        execution_count: 4,
        avg_duration_sec: 2.5,
        median_duration_sec: null,
        p95_duration_sec: 5,
        total_time_sec: 10,
      },
    ])
  })

  it("returns a null KPI (no fabricated zeros) when the window saw nothing", async () => {
    const instant = vi.fn(async (): Promise<PromSample[]> => [])
    const res = await analyzePerformance(
      { instant },
      { processDefinitionKey: "order", period: "7d", includeActivityBreakdown: false },
    )
    expect(res.kpi).toBeNull()
    expect(res.activityBreakdown).toEqual([])
  })

  it("keeps the KPI when instances ended but none started, with an unmeasured rate", async () => {
    const instant = vi.fn(async (q: string): Promise<PromSample[]> =>
      q.includes('state="COMPLETED"')
        ? [v(3)]
        : q.includes("duration_milliseconds_sum")
          ? [v(60_000)]
          : [],
    )
    const res = await analyzePerformance(
      { instant },
      { processDefinitionKey: "order", period: "1d", includeActivityBreakdown: false },
    )
    expect(res.kpi).toMatchObject({
      total_instances: 0,
      completed: 3,
      incident_rate_pct: null,
      avg_duration_sec: 60,
      p95_duration_sec: null,
    })
  })

  it("skips the breakdown queries when includeActivityBreakdown is false", async () => {
    const { ch, instant } = mockClient()
    await analyzePerformance(ch, {
      processDefinitionKey: "order",
      period: "7d",
      includeActivityBreakdown: false,
    })
    const queries = instant.mock.calls.map((c) => c[0])
    expect(queries).toHaveLength(6)
    expect(queries.some((q) => q.includes("camunda_activity_"))).toBe(false)
  })
})

describe("comparePeriods", () => {
  const NOW = "2026-02-05T00:00:00Z"
  const NOW_SEC = Date.parse(NOW) / 1000
  const PERIOD_A = { from: "2026-01-10T00:00:00Z", to: "2026-01-11T00:00:00Z" }
  const PERIOD_B = { from: "2026-02-01T00:00:00Z", to: "2026-02-03T00:00:00Z" }
  const AT_A = `@ ${Date.parse(PERIOD_A.to) / 1000}`
  const base = {
    processDefinitionKey: "order",
    periodAFrom: PERIOD_A.from,
    periodATo: PERIOD_A.to,
    periodBFrom: PERIOD_B.from,
    periodBTo: PERIOD_B.to,
    includeActivityBreakdown: false,
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse(NOW) })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("labels both windows and resolves each KPI from its own historical window", async () => {
    const instant = vi.fn(async (q: string): Promise<PromSample[]> => {
      const count = q.includes(AT_A) ? 10 : 30
      if (q.includes("histogram_quantile")) return [v(count * 100)]
      if (q.includes("duration_milliseconds_sum")) return [v(count * 100)]
      if (q.includes("incident_created")) return [v(1)]
      if (q.includes('state="COMPLETED"')) return [v(count - 2)]
      return [v(count)]
    })

    const res = await comparePeriods({ instant }, base)

    expect(res.activityComparison).toBeUndefined()
    expect(res.kpiComparison).toEqual([
      {
        period: "Period A",
        window_from: "2026-01-10T00:00:00.000Z",
        window_to: "2026-01-11T00:00:00.000Z",
        window_days: 1,
        partial: false,
        total_instances: 10,
        started_per_day: 10,
        completed: 8,
        incident_count: 1,
        incident_rate_pct: 10,
        avg_duration_sec: 1,
        median_sec: 1,
        p95_sec: 1,
      },
      {
        period: "Period B",
        window_from: "2026-02-01T00:00:00.000Z",
        window_to: "2026-02-03T00:00:00.000Z",
        window_days: 2,
        partial: false,
        total_instances: 30,
        // Twice the window: per day, B runs 1.5× A — not 3×.
        started_per_day: 15,
        completed: 28,
        incident_count: 1,
        incident_rate_pct: 3.3,
        avg_duration_sec: 3,
        median_sec: 3,
        p95_sec: 3,
      },
    ])
  })

  it.each([
    // [label, window, starts, true starts per day]
    ["10 minutes", ["2026-02-01T00:00:00Z", "2026-02-01T00:10:00Z"], 4, 576],
    ["1 hour", ["2026-02-01T00:00:00Z", "2026-02-01T01:00:00Z"], 24, 576],
    // Rounded to 0.00 days this window used to read as "not measured".
    ["5 minutes", ["2026-02-01T00:00:00Z", "2026-02-01T00:05:00Z"], 3, 864],
  ])(
    "rates a %s window's starts per day from its exact length, not the rounded window_days",
    async (_label, [from, to], starts, perDay) => {
      const instant = vi.fn(async (q: string): Promise<PromSample[]> =>
        q.includes("started_total") && !q.includes(AT_A) ? [v(starts)] : [],
      )
      const res = await comparePeriods({ instant }, { ...base, periodBFrom: from, periodBTo: to })
      expect(res.kpiComparison[1].started_per_day).toBe(perDay)
    },
  )

  it("clamps a window reaching past now and flags it partial (N79)", async () => {
    const sent: string[] = []
    const instant = (q: string): Promise<PromSample[]> => {
      sent.push(q)
      return Promise.resolve([v(1)])
    }
    const res = await comparePeriods(
      { instant },
      { ...base, periodBFrom: "2026-02-04T00:00:00Z", periodBTo: "2026-02-11T00:00:00Z" },
    )
    expect(res.kpiComparison[1]).toMatchObject({
      window_to: "2026-02-05T00:00:00.000Z",
      window_days: 1,
      partial: true,
    })
    const anchors = sent.map((q) => Number(/@ (\d+)/.exec(q)?.[1]))
    expect(anchors.every((at) => at <= NOW_SEC)).toBe(true)
  })

  it.each([
    ["reversed", "2026-02-03T00:00:00Z", "2026-02-01T00:00:00Z", /ends before it starts/],
    ["empty", "2026-02-01T00:00:00Z", "2026-02-01T00:00:00Z", /ends before it starts/],
    ["in the future", "2026-02-06T00:00:00Z", "2026-02-07T00:00:00Z", /lies in the future/],
    ["before retention", "2025-11-01T00:00:00Z", "2025-11-02T00:00:00Z", /30-day/],
  ])("refuses a %s window before any PromQL is sent", async (_label, from, to, message) => {
    const instant = vi.fn(async (): Promise<PromSample[]> => [])
    await expect(
      comparePeriods({ instant }, { ...base, periodBFrom: from, periodBTo: to }),
    ).rejects.toThrow(message)
    expect(instant).not.toHaveBeenCalled()
  })

  it("rejects unparsable period timestamps before any PromQL is sent", async () => {
    const instant = vi.fn(async (): Promise<PromSample[]> => [])

    await expect(
      comparePeriods({ instant }, { ...base, periodAFrom: "last week" }),
    ).rejects.toThrow(/periodAFrom "last week" is not a parseable ISO datetime/)
    expect(instant).not.toHaveBeenCalled()
  })

  it("sorts the optional activity comparison by activity id, then period", async () => {
    const instant = vi.fn(async (q: string): Promise<PromSample[]> => {
      if (q.includes("camunda_activity_ended_total")) {
        return [
          { metric: { activity_id: "B" }, value: 2 },
          { metric: { activity_id: "A" }, value: 4 },
        ]
      }
      if (q.includes("camunda_activity_duration_milliseconds_sum")) {
        return [{ metric: { activity_id: "A" }, value: 8_000 }]
      }
      if (q.includes("activity_id, le")) {
        return [{ metric: { activity_id: "A" }, value: 3_000 }]
      }
      return []
    })

    const res = await comparePeriods({ instant }, { ...base, includeActivityBreakdown: true })

    expect(
      res.activityComparison!.map((r) => [
        r.activity_id,
        r.period,
        r.executions,
        r.avg_sec,
        r.p95_sec,
      ]),
    ).toEqual([
      ["A", "Period A", 4, 2, 3],
      ["A", "Period B", 4, 2, 3],
      // No duration series for B: unmeasured, not 0 s.
      ["B", "Period A", 2, null, null],
      ["B", "Period B", 2, null, null],
    ])
  })
})
