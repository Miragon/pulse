import { describe, expect, it, vi } from "vitest"
import { versionCompare } from "./version-compare.js"
import { increaseIn } from "./helpers.js"
import type { PrometheusClient, PromSample } from "../prometheus.js"

const v = (value: number): PromSample => ({ metric: {}, value })

/** Canned KPIs per version; durations in ms, the histogram's unit. */
type Canned = { started: number; completed: number; incidents: number; avg: number; p95: number }

function mockClient(byVersion: Record<string, Canned>) {
  const answer = (q: string): PromSample[] => {
    const version = /process_definition_version="(\d+)"/.exec(q)?.[1] ?? ""
    const kpi = byVersion[version]
    if (!kpi) return []
    if (q.includes("histogram_quantile")) return [v(kpi.p95)]
    if (q.includes("duration_milliseconds_sum")) return [v(kpi.avg)]
    if (q.includes("incident_created")) return [v(kpi.incidents)]
    if (q.includes('state="COMPLETED"')) return [v(kpi.completed)]
    return [v(kpi.started)]
  }
  const instant = vi.fn((q: string) => Promise.resolve(answer(q)))
  const ch: PrometheusClient = { instant }
  return { ch, instant, sent: () => instant.mock.calls.map((c) => c[0]) }
}

const base = {
  processDefinitionKey: "order",
  versionA: 1,
  versionB: 2,
  windowDays: 14,
  minBucketSize: 10,
}

const versions = {
  "1": { started: 99.6, completed: 80.4, incidents: 5, avg: 10_040, p95: 20_000 },
  "2": { started: 50, completed: 40, incidents: 4, avg: 12_060, p95: 30_000 },
}

describe("versionCompare", () => {
  it("partitions the process-instance and incident series by version", async () => {
    const { ch, sent } = mockClient(versions)
    await versionCompare(ch, { ...base, engine: "prod-a" })

    const sel = (ver: number, extra = "") =>
      `{process_definition_key="order",process_definition_version="${ver}"${extra},engine_id="prod-a"}`
    const w = { range: "14d" }
    const count = (series: string) => increaseIn(series, w)
    const duration = "camunda_process_instance_duration_milliseconds"
    const queries = (ver: number) => [
      `sum(${count(`camunda_process_instance_started_total${sel(ver)}`)})`,
      `sum(${count(`camunda_process_instance_ended_total${sel(ver, ',state="COMPLETED"')}`)})`,
      `sum(${count(`camunda_incident_created_total${sel(ver)}`)})`,
      `sum(${count(`${duration}_sum${sel(ver)}`)}) / sum(${count(`${duration}_count${sel(ver)}`)})`,
      `histogram_quantile(0.95, sum by (le)(${count(`${duration}_bucket${sel(ver)}`)}))`,
    ]
    expect(sent()).toEqual([...queries(1), ...queries(2)])
  })

  it("reports instance, completion, incident and duration KPIs per version", async () => {
    const { ch } = mockClient(versions)
    const res = await versionCompare(ch, base)

    expect(res.kpis).toEqual([
      {
        version: 1,
        bucket: "versionA",
        instance_count: 100,
        completed_count: 80,
        incident_count: 5,
        incident_rate_pct: 5,
        element_incident_count: null,
        element_incident_rate_pct: null,
        avg_duration_sec: 10,
        p95_duration_sec: 20,
      },
      {
        version: 2,
        bucket: "versionB",
        instance_count: 50,
        completed_count: 40,
        incident_count: 4,
        incident_rate_pct: 8,
        element_incident_count: null,
        element_incident_rate_pct: null,
        avg_duration_sec: 12.1,
        p95_duration_sec: 30,
      },
    ])
    expect(res.delta).toEqual({
      started_per_day_delta_pct: -50,
      incident_rate_delta_pp: 3,
      element_incident_rate_delta_pp: null,
      avg_duration_delta_pct: 21,
      p95_duration_delta_pct: 50,
    })
  })

  it("echoes the request and has no element scope", async () => {
    const { ch } = mockClient(versions)
    const res = await versionCompare(ch, base)

    expect(res).toMatchObject({
      processDefinitionKey: "order",
      versionA: 1,
      versionB: 2,
      windowDays: 14,
      minBucketSize: 10,
      suppressed: false,
    })
    expect(res).not.toHaveProperty("activityId")
  })

  it("returns null deltas on a zero baseline instead of dividing by zero", async () => {
    const { ch } = mockClient({ "2": versions["2"] })
    const res = await versionCompare(ch, { ...base, minBucketSize: 1 })

    // No series for v1 at all: unmeasured, never a 0 s duration.
    expect(res.kpis[0]).toMatchObject({ instance_count: 0, avg_duration_sec: null })
    expect(res.delta.started_per_day_delta_pct).toBeNull()
    expect(res.delta.avg_duration_delta_pct).toBeNull()
    expect(res.delta.p95_duration_delta_pct).toBeNull()
    expect(res.suppressed).toBe(true)
  })

  it.each([
    [{ "1": 50, "2": 50 }, 50, false],
    [{ "1": 49, "2": 50 }, 50, true],
    [{ "1": 50, "2": 49 }, 50, true],
  ])("suppresses below minBucketSize per version (%j, min %i)", async (counts, min, expected) => {
    const canned = (started: number) => ({
      started,
      completed: started,
      incidents: 0,
      avg: 1,
      p95: 1,
    })
    const { ch } = mockClient({ "1": canned(counts["1"]), "2": canned(counts["2"]) })
    const res = await versionCompare(ch, { ...base, minBucketSize: min })
    expect(res.suppressed).toBe(expected)
  })

  it("floors and clamps the numeric inputs to sane minimums", async () => {
    const { ch, sent } = mockClient(versions)
    const res = await versionCompare(ch, {
      ...base,
      versionA: 0,
      versionB: 2.9,
      windowDays: 0.5,
      minBucketSize: 0,
    })

    expect(res).toMatchObject({ versionA: 1, versionB: 2, windowDays: 1, minBucketSize: 1 })
    expect(res.kpis.map((k) => k.version)).toEqual([1, 2])
    expect(sent().every((q) => q.includes("[1d]"))).toBe(true)

    const floored = await versionCompare(ch, { ...base, windowDays: 7.9, minBucketSize: 2.7 })
    expect(floored).toMatchObject({ windowDays: 7, minBucketSize: 2 })
  })

  it("escapes the key and applies a multi-engine filter to every query", async () => {
    const { ch, sent } = mockClient(versions)
    await versionCompare(ch, {
      ...base,
      processDefinitionKey: 'my"key',
      engine: ["prod-a", "prod-b"],
    })

    expect(sent()).toHaveLength(10)
    expect(sent().every((q) => q.includes('process_definition_key="my\\"key"'))).toBe(true)
    expect(sent().every((q) => q.includes('engine_id=~"prod-a|prod-b"'))).toBe(true)
  })

  it("aggregates across engines when no engine filter is given", async () => {
    const { ch, sent } = mockClient(versions)
    await versionCompare(ch, base)
    expect(sent().some((q) => q.includes("engine_id"))).toBe(false)
  })
})
