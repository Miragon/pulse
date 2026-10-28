import { describe, expect, it, vi } from "vitest"
import { elementBottleneck } from "./element.js"
import type { PrometheusClient, PromSample } from "../prometheus.js"

function mockClient() {
  const instant = vi.fn(async (q: string): Promise<PromSample[]> => {
    if (q.includes("activity_type")) {
      return [
        { metric: { activity_id: "A", activity_type: "serviceTask" }, value: 10 },
        { metric: { activity_id: "B", activity_type: "userTask" }, value: 5 },
      ]
    }
    // Durations in ms, the histogram's unit.
    if (q.includes("histogram_quantile")) {
      return [
        { metric: { activity_id: "A" }, value: 15_000 },
        { metric: { activity_id: "B" }, value: 6_000 },
      ]
    }
    if (q.includes("duration_milliseconds_sum")) {
      return [
        { metric: { activity_id: "A" }, value: 100_000 },
        { metric: { activity_id: "B" }, value: 20_000 },
      ]
    }
    if (q.includes("incident_created")) {
      return [{ metric: { activity_id: "A" }, value: 2 }]
    }
    return [
      { metric: { activity_id: "A" }, value: 10 },
      { metric: { activity_id: "B" }, value: 5 },
    ]
  })
  const ch: PrometheusClient = { instant }
  return { ch, instant }
}

describe("elementBottleneck", () => {
  it("ranks activities by time contribution and maps incident rate; wait time is null on metrics", async () => {
    const { ch } = mockClient()
    const res = await elementBottleneck(ch, {
      processDefinitionKey: "miraveloLeasing",
      period: "7d",
      minBucketSize: 1,
      maxResults: 10,
    })

    expect(res.activities).toHaveLength(2)
    const [a, b] = res.activities
    expect(a).toMatchObject({
      activity_id: "A",
      activity_type: "serviceTask",
      execution_count: 10,
      avg_duration_sec: 10,
      p95_duration_sec: 15,
      total_time_sec: 100,
      incident_count: 2,
      incident_rate_pct: 20,
      bottleneck_score_sec: 100,
      avg_wait_sec: null,
      total_wait_sec: null,
    })
    expect(b.activity_id).toBe("B")
    expect(b.incident_count).toBe(0)
    expect(res.suppressedActivities).toBe(0)
  })

  it("suppresses activities below minBucketSize", async () => {
    const { ch } = mockClient()
    const res = await elementBottleneck(ch, {
      processDefinitionKey: "miraveloLeasing",
      period: "7d",
      minBucketSize: 8,
      maxResults: 10,
    })
    expect(res.activities.map((r) => r.activity_id)).toEqual(["A"])
    expect(res.suppressedActivities).toBe(1)
  })

  it("reports a missing histogram sample as an unmeasured p95, never 0 s", async () => {
    const instant = vi.fn(async (q: string): Promise<PromSample[]> =>
      q.includes("histogram_quantile") ||
      q.includes("duration_milliseconds_sum") ||
      q.includes("incident")
        ? []
        : [{ metric: { activity_id: "A", activity_type: "serviceTask" }, value: 4 }],
    )
    const res = await elementBottleneck(
      { instant },
      { processDefinitionKey: "k", period: "7d", minBucketSize: 1, maxResults: 5 },
    )
    expect(res.activities[0]).toMatchObject({
      execution_count: 4,
      avg_duration_sec: null,
      p95_duration_sec: null,
      incident_rate_pct: 0,
    })
  })

  it("scopes every query to the process definition key and period", async () => {
    const { ch, instant } = mockClient()
    await elementBottleneck(ch, {
      processDefinitionKey: "myKey",
      period: "30d",
      minBucketSize: 1,
      maxResults: 5,
    })
    const queries = instant.mock.calls.map((c) => c[0])
    expect(queries.every((q) => q.includes('process_definition_key="myKey"'))).toBe(true)
    expect(queries.every((q) => q.includes("[30d]"))).toBe(true)
  })
})
