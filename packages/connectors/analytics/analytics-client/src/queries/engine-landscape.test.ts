import { describe, expect, it, vi } from "vitest"
import { engineLandscape } from "./engine-landscape.js"
import type { PrometheusClient, PromSample } from "../prometheus.js"

const cell = (engine_id: string, process_definition_key: string, value: number): PromSample => ({
  metric: { engine_id, process_definition_key },
  value,
})
const gauge = (engine_id: string, value: number): PromSample => ({ metric: { engine_id }, value })

/**
 * Two engines with a partly overlapping process landscape: `order` runs on
 * both (the only comparable key), `invoice` only on prod-a, `onboarding` only
 * on prod-b.
 */
function mockClient() {
  const instant = vi.fn(async (q: string): Promise<PromSample[]> => {
    if (q.includes("process_definitions_deployed")) {
      return [
        cell("prod-a", "order", 3),
        cell("prod-a", "invoice", 1),
        cell("prod-b", "order", 2),
        cell("prod-b", "onboarding", 1),
      ]
    }
    if (q.includes("process_instances_running")) {
      return [
        cell("prod-a", "order", 5),
        cell("prod-a", "invoice", 2),
        cell("prod-b", "order", 7),
        cell("prod-b", "onboarding", 4),
      ]
    }
    if (q.includes("incidents_open")) {
      // `sum by (engine_id, process_definition_key)` folds `incident_type`
      // away, so there is one sample per pair however many types produced it.
      return [cell("prod-a", "order", 3), cell("prod-b", "onboarding", 4)]
    }
    if (q.includes("jobs_failed")) return [cell("prod-a", "order", 3)]
    if (q.includes("jobs_executable")) return [gauge("prod-a", 12), gauge("prod-b", 40)]
    if (q.includes("jobs_suspended")) return [gauge("prod-b", 2)]
    if (q.includes("jobs_due_future")) return [gauge("prod-a", 8)]
    if (q.includes("external_tasks_open")) return [gauge("prod-b", 6)]
    return []
  })
  const ch: PrometheusClient = { instant }
  return { ch, instant }
}

describe("engineLandscape", () => {
  it("reports absolute load and the engine-owned backlog per engine", async () => {
    const { ch } = mockClient()
    const res = await engineLandscape(ch)

    expect(res.engines).toEqual([
      {
        engineId: "prod-a",
        reporting: true,
        runningInstances: 7,
        openIncidents: 3,
        failedJobs: 3,
        executableJobs: 12,
        suspendedJobs: 0,
        jobsDueFuture: 8,
        openExternalTasks: 0,
        deployedDefinitionKeys: 2,
        exclusiveDefinitionKeys: 1, // invoice
      },
      {
        engineId: "prod-b",
        reporting: true,
        runningInstances: 11,
        openIncidents: 4,
        failedJobs: 0,
        executableJobs: 40,
        suspendedJobs: 2,
        jobsDueFuture: 0,
        openExternalTasks: 6,
        deployedDefinitionKeys: 2,
        exclusiveDefinitionKeys: 1, // onboarding
      },
    ])
  })

  it("marks only the process deployed on more than one engine as shared", async () => {
    const { ch } = mockClient()
    const res = await engineLandscape(ch)

    expect(res.sharedProcessKeys).toEqual(["order"])
    expect(res.processes.map((p) => p.processDefinitionKey)).toEqual([
      "order",
      "onboarding",
      "invoice",
    ])
    expect(res.processes[0]).toEqual({
      processDefinitionKey: "order",
      engineIds: ["prod-a", "prod-b"],
      shared: true,
      runningByEngine: { "prod-a": 5, "prod-b": 7 },
      runningTotal: 12,
      openIncidentsTotal: 3,
      failedJobsTotal: 3,
    })
    expect(res.processes[2]).toMatchObject({
      processDefinitionKey: "invoice",
      engineIds: ["prod-a"],
      shared: false,
    })
  })

  it("totals the landscape without double counting", async () => {
    const { ch } = mockClient()
    const res = await engineLandscape(ch)

    expect(res.totals).toEqual({
      engineCount: 2,
      reportingEngineCount: 2,
      processKeyCount: 3,
      sharedProcessKeyCount: 1,
      runningInstances: 18,
      openIncidents: 7,
      failedJobs: 3,
    })
  })

  it("keeps a configured engine that reports no metrics visible", async () => {
    const { ch } = mockClient()
    const res = await engineLandscape(ch, { engine: ["prod-a", "prod-b", "prod-c"] })

    const silent = res.engines.find((e) => e.engineId === "prod-c")
    // Unknown, not zero: a row of 0s would read as an idle, healthy engine.
    expect(silent).toEqual({
      engineId: "prod-c",
      reporting: false,
      runningInstances: null,
      openIncidents: null,
      failedJobs: null,
      executableJobs: null,
      suspendedJobs: null,
      jobsDueFuture: null,
      openExternalTasks: null,
      deployedDefinitionKeys: null,
      exclusiveDefinitionKeys: null,
    })
    expect(res.totals).toMatchObject({
      engineCount: 3,
      reportingEngineCount: 2,
      runningInstances: 18,
      openIncidents: 7,
    })
  })

  it("scopes every query by the engine filter", async () => {
    const { ch, instant } = mockClient()
    await engineLandscape(ch, { engine: ["prod-a", "prod-b"] })

    const queries = instant.mock.calls.map((c) => c[0])
    expect(queries).toHaveLength(8)
    expect(queries.every((q) => q.includes('{engine_id=~"prod-a|prod-b"}'))).toBe(true)
    // The four process-scoped metrics group by both labels, the four
    // engine-owned gauges by engine_id only.
    expect(
      queries.filter((q) => q.includes("by (engine_id, process_definition_key)")),
    ).toHaveLength(4)
  })

  it("returns an empty landscape instead of failing when nothing reports", async () => {
    const res = await engineLandscape({ instant: async () => [] })

    expect(res.engines).toEqual([])
    expect(res.processes).toEqual([])
    expect(res.totals).toMatchObject({
      engineCount: 0,
      processKeyCount: 0,
      runningInstances: null,
      openIncidents: null,
      failedJobs: null,
    })
  })
})
