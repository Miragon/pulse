import { describe, expect, it, vi } from "vitest"
import { engineCompare } from "./engine-compare.js"
import type { PrometheusClient, PromSample } from "../prometheus.js"

const v = (value: number): PromSample => ({ metric: {}, value })

interface Canned {
  started: number
  completed: number
  incidents: number
  elementIncidents?: number
  /** `null` = the duration series is absent (nothing ended): NaN, dropped by the client. */
  avg: number | null
  p95: number | null
}

function mockClient(
  byEngine: Record<"prod-a" | "prod-b", Canned> = {
    "prod-a": { started: 100, completed: 80, incidents: 10, avg: 10, p95: 20 },
    "prod-b": { started: 50, completed: 40, incidents: 10, avg: 12, p95: 30 },
  },
) {
  const instant = vi.fn(async (q: string): Promise<PromSample[]> => {
    const engine = q.includes('engine_id="prod-a"') ? byEngine["prod-a"] : byEngine["prod-b"]
    const maybe = (value: number | null) => (value === null ? [] : [v(value)])
    // Canned durations are seconds; the histogram answers in ms.
    const ms = (sec: number | null) => (sec === null ? null : sec * 1000)
    if (q.includes("histogram_quantile")) return maybe(ms(engine.p95))
    if (q.includes("duration_milliseconds_sum")) return maybe(ms(engine.avg))
    if (q.includes("incident_created") && q.includes("activity_id")) {
      return [v(engine.elementIncidents ?? 0)]
    }
    if (q.includes("incident_created")) return [v(engine.incidents)]
    if (q.includes('state="COMPLETED"')) return [v(engine.completed)]
    return [v(engine.started)]
  })
  const ch: PrometheusClient = { instant }
  return { ch, instant }
}

const params = {
  processDefinitionKey: "order",
  engineA: "prod-a",
  engineB: "prod-b",
  windowDays: 14,
  minBucketSize: 10,
}

describe("engineCompare", () => {
  it("computes per-engine KPIs and the B-vs-A delta for one process", async () => {
    const { ch } = mockClient()
    const res = await engineCompare(ch, params)

    expect(res).toMatchObject({
      engineA: "prod-a",
      engineB: "prod-b",
      processDefinitionKey: "order",
      windowDays: 14,
      activityId: null,
      minBucketSize: 10,
      suppressed: false,
    })
    expect(res.kpis).toEqual([
      {
        engineId: "prod-a",
        bucket: "engineA",
        instance_count: 100,
        completed_count: 80,
        incident_count: 10,
        incident_rate_pct: 10,
        element_incident_count: null,
        element_incident_rate_pct: null,
        avg_duration_sec: 10,
        p95_duration_sec: 20,
      },
      {
        engineId: "prod-b",
        bucket: "engineB",
        instance_count: 50,
        completed_count: 40,
        incident_count: 10,
        incident_rate_pct: 20,
        element_incident_count: null,
        element_incident_rate_pct: null,
        avg_duration_sec: 12,
        p95_duration_sec: 30,
      },
    ])
    expect(res.delta).toEqual({
      started_per_day_delta_pct: -50,
      incident_rate_delta_pp: 10,
      element_incident_rate_delta_pp: null,
      avg_duration_delta_pct: 20,
      p95_duration_delta_pct: 50,
    })
  })

  it("reports the element's incidents NEXT TO the process-wide ones, never instead", async () => {
    const { ch, instant } = mockClient({
      "prod-a": {
        started: 100,
        completed: 80,
        incidents: 10,
        elementIncidents: 4,
        avg: 10,
        p95: 20,
      },
      "prod-b": {
        started: 50,
        completed: 40,
        incidents: 10,
        elementIncidents: 1,
        avg: 12,
        p95: 30,
      },
    })
    const res = await engineCompare(ch, { ...params, activityId: "Task_check" })
    expect(res.kpis.map((k) => [k.incident_rate_pct, k.element_incident_rate_pct])).toEqual([
      [10, 4],
      [20, 2],
    ])
    expect(res.delta.element_incident_rate_delta_pp).toBe(-2)
    // One extra query per engine, only for the element count.
    expect(instant.mock.calls.filter(([q]) => q.includes('activity_id="Task_check"'))).toHaveLength(
      2,
    )
  })

  it("flags the comparison as suppressed when one engine misses minBucketSize", async () => {
    const { ch } = mockClient()
    expect((await engineCompare(ch, { ...params, minBucketSize: 60 })).suppressed).toBe(true)
  })

  it("flags it suppressed when too few instances COMPLETED — the durations' sample", async () => {
    const { ch } = mockClient({
      "prod-a": { started: 100, completed: 80, incidents: 0, avg: 10, p95: 20 },
      "prod-b": { started: 100, completed: 3, incidents: 0, avg: 1, p95: 2 },
    })
    expect((await engineCompare(ch, params)).suppressed).toBe(true)
  })

  it("reads 'nothing ended' as an unmeasured duration and suppresses its delta (N78)", async () => {
    // prod-b started work but nothing ended yet: the duration ratio is NaN,
    // which the client drops — formerly a 0 s duration and a −100 % delta.
    const { ch } = mockClient({
      "prod-a": { started: 100, completed: 80, incidents: 5, avg: 10, p95: 20 },
      "prod-b": { started: 40, completed: 0, incidents: 0, avg: null, p95: null },
    })
    const res = await engineCompare(ch, params)
    expect(res.kpis[1]).toMatchObject({ avg_duration_sec: null, p95_duration_sec: null })
    expect(res.delta.avg_duration_delta_pct).toBeNull()
    expect(res.delta.p95_duration_delta_pct).toBeNull()
    expect(res.suppressed).toBe(true)
  })

  it("returns null deltas instead of dividing by a zero baseline", async () => {
    const instant = vi.fn(async (): Promise<PromSample[]> => [])
    const res = await engineCompare({ instant }, { ...params, windowDays: 7, minBucketSize: 1 })
    expect(res.suppressed).toBe(true)
    expect(Object.values(res.delta).every((d) => d === null)).toBe(true)
    expect(res.kpis.every((k) => k.incident_rate_pct === null)).toBe(true)
  })

  it("partitions every query by exactly one engine_id and always holds the process fixed", async () => {
    const { ch, instant } = mockClient()
    await engineCompare(ch, params)
    const queries = instant.mock.calls.map((c) => c[0])
    expect(queries).toHaveLength(10)
    const aQueries = queries.filter((q) => q.includes('engine_id="prod-a"'))
    const bQueries = queries.filter((q) => q.includes('engine_id="prod-b"'))
    expect(aQueries).toHaveLength(5)
    expect(bQueries).toHaveLength(5)
    // The scope that makes the delta attributable to the engine rather than to
    // a different process mix — never absent.
    expect(queries.every((q) => q.includes('process_definition_key="order"'))).toBe(true)
    expect(queries.every((q) => q.includes("[14d]"))).toBe(true)
  })
})
