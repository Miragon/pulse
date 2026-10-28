import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PrometheusClient, PromSample } from "../prometheus.js"
import { clusterCompare } from "./cluster-compare.js"
import { dashboardData, failureDashboardData } from "./dashboard.js"
import { elementHeat } from "./element.js"
import { engineCompare } from "./engine-compare.js"
import { engineLandscape } from "./engine-landscape.js"
import { versionCompare } from "./version-compare.js"

const NOW = "2026-10-10T12:32:00.000Z"

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(NOW))
})
afterEach(() => vi.useRealTimers())

function client(reporting: string[] = []): PrometheusClient {
  return {
    instant: vi.fn((q: string): Promise<PromSample[]> =>
      Promise.resolve(
        q.includes("camunda_jobs_executable")
          ? reporting.map((engine_id) => ({ metric: { engine_id }, value: 1 }))
          : [],
      ),
    ),
  }
}

describe("asOf — when the figures were read", () => {
  it("stamps every view result with the query time", async () => {
    const results = await Promise.all([
      dashboardData(client(), { period: "7d" }),
      failureDashboardData(client(), {}),
      versionCompare(client(), {
        processDefinitionKey: "order",
        versionA: 1,
        versionB: 2,
        windowDays: 14,
        minBucketSize: 10,
      }),
      engineCompare(client(), {
        processDefinitionKey: "order",
        engineA: "prod-a",
        engineB: "prod-b",
        windowDays: 14,
        minBucketSize: 10,
      }),
      engineLandscape(client(), { engine: ["prod-a"] }),
      elementHeat(client(), { processDefinitionKey: "order", period: "7d" }),
    ])
    for (const result of results) expect(result.asOf).toBe(NOW)
  })

  it("stamps a deployment comparison with the `now` its windows were clamped to", async () => {
    const res = await clusterCompare(client(), {
      deploymentTimestamp: "2026-10-08T12:00:00Z",
      windowBeforeDays: 7,
      windowAfterDays: 7,
      minBucketSize: 10,
    })
    expect(res.asOf).toBe(NOW)
    // The post-deployment window ends at that same `now`.
    expect(res.partial).toBe(true)
  })
})

describe("reportingEngines — which engines in scope send metrics", () => {
  it("lists the engines the presence probe answered for, ascending and once each", async () => {
    const res = await dashboardData(client(["prod-c", "prod-a", "prod-c"]), {
      period: "7d",
      engine: ["prod-a", "prod-b", "prod-c"],
    })
    expect(res.reportingEngines).toEqual(["prod-a", "prod-c"])
  })

  it("is empty when no engine in scope reports, and skips a series without an engine id", async () => {
    const instant = vi.fn((q: string): Promise<PromSample[]> =>
      Promise.resolve(q.includes("camunda_jobs_executable") ? [{ metric: {}, value: 1 }] : []),
    )
    expect((await dashboardData({ instant }, { period: "7d" })).reportingEngines).toEqual([])
    expect((await dashboardData(client(), { period: "7d" })).reportingEngines).toEqual([])
  })
})
