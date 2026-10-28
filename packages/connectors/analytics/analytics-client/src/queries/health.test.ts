import { describe, expect, it, vi } from "vitest"
import { ENGINE_HEALTH_STATUS_RULE, engineHealth } from "./health.js"
import type { PrometheusClient, PromSample } from "../prometheus.js"

const sample = (metric: Record<string, string>, value: number): PromSample => ({ metric, value })

interface Fixture {
  /** Engines whose engine-only gauges exist (default: one reporting engine). */
  reporting?: string[]
  running?: PromSample[]
  incidents?: PromSample[]
  dead?: number
  firing?: PromSample[]
  pending?: PromSample[]
}

function mockClient(fixture: Fixture = {}) {
  const scalar = (value: number | undefined) => (value === undefined ? [] : [sample({}, value)])
  const perEngine = (value: number) =>
    (fixture.reporting ?? ["prod-a"]).map((engine_id) => sample({ engine_id }, value))
  const instant = vi.fn(async (q: string): Promise<PromSample[]> => {
    if (q.startsWith("ALERTS")) {
      return (q.includes('"firing"') ? fixture.firing : fixture.pending) ?? []
    }
    if (q.includes("process_instances_running")) return fixture.running ?? []
    if (q.includes("incidents_open")) return fixture.incidents ?? []
    if (q.includes("jobs_failed")) return scalar(fixture.dead)
    if (q.includes("jobs_executable")) return perEngine(6.2)
    if (q.includes("jobs_suspended")) return scalar(2)
    if (q.includes('status="total"')) return scalar(9)
    if (q.includes('status="unassigned"')) return scalar(4)
    if (q.includes("external_tasks_open")) return perEngine(3.3)
    if (q.includes("process_definitions_deployed")) return scalar(3)
    return []
  })
  const ch: PrometheusClient = { instant }
  return { ch, instant }
}

const alert = (alertname: string, severity: string, scope: Record<string, string> = {}) =>
  sample({ alertname, severity, ...scope }, 1)

describe("engineHealth snapshot", () => {
  it("reports every gauge, rounded, with breakdowns sorted and zero rows dropped", async () => {
    const { ch } = mockClient({
      reporting: ["prod-a", "prod-b"],
      running: [
        sample({ process_definition_key: "invoice" }, 2),
        sample({ process_definition_key: "order" }, 7.4),
        sample({ process_definition_key: "idle" }, 0.2),
        sample({}, 1),
      ],
      incidents: [sample({ incident_type: "failedJob" }, 3)],
      dead: 1.6,
    })
    const result = await engineHealth(ch, {})
    expect(result).toMatchObject({
      engines: null,
      reportingEngines: ["prod-a", "prod-b"],
      silentEngines: [],
      runningInstances: 10,
      runningByDefinition: [
        { label: "order", count: 7 },
        { label: "invoice", count: 2 },
        { label: "", count: 1 },
      ],
      openIncidents: 3,
      openIncidentsByType: [{ label: "failedJob", count: 3 }],
      deadJobs: 2,
      executableJobs: 12,
      suspendedJobs: 2,
      openUserTasks: 9,
      unassignedUserTasks: 4,
      openExternalTasks: 7,
      deployedDefinitionKeys: 3,
    })
  })

  it("names each alert's scope by process, else incident type, else engine", async () => {
    const { ch } = mockClient({
      firing: [
        alert("A", "warning", { process_definition_key: "order", incident_type: "x" }),
        alert("B", "warning", { incident_type: "failedJob", engine_id: "prod-a" }),
        alert("C", "warning", { engine_id: "prod-a" }),
        sample({}, 1),
      ],
      pending: [alert("D", "info")],
    })
    const result = await engineHealth(ch, {})
    expect(result.firingAlerts).toEqual([
      { name: "A", severity: "warning", scope: "order" },
      { name: "B", severity: "warning", scope: "failedJob" },
      { name: "C", severity: "warning", scope: "prod-a" },
      { name: "", severity: "", scope: "" },
    ])
    expect(result.pendingAlerts).toEqual([{ name: "D", severity: "info", scope: "" }])
  })
})

/**
 * #340: the verdict is alert-based and says so — the same engine may be
 * "critical" in camunda7_show_engine_health (incident counts) and only
 * "degraded" here. #336: silence is not health.
 */
describe("engineHealth verdict", () => {
  it.each<[string, Fixture, string]>([
    ["a reporting engine without any signal", {}, "healthy"],
    ["one open incident", { incidents: [sample({ incident_type: "failedJob" }, 1)] }, "degraded"],
    ["one dead job", { dead: 1 }, "degraded"],
    ["a firing warning", { firing: [alert("Slow", "warning")] }, "degraded"],
    ["a firing critical alert", { firing: [alert("NoMetrics", "critical")] }, "critical"],
    ["a merely PENDING critical alert", { pending: [alert("NoMetrics", "critical")] }, "healthy"],
    [
      "500 open incidents without a critical alert",
      { incidents: [sample({ incident_type: "failedJob" }, 500)] },
      "degraded",
    ],
    ["no engine reporting any metric", { reporting: [] }, "unknown"],
    [
      "no engine reporting, even with a critical alert firing",
      { reporting: [], firing: [alert("CibSevenEngineNoMetrics", "critical")] },
      "unknown",
    ],
  ])("%s → %s", async (_label, fixture, status) => {
    const result = await engineHealth(mockClient(fixture).ch, {})
    expect(result.status).toBe(status)
    expect(result.statusRule).toBe(ENGINE_HEALTH_STATUS_RULE)
  })

  it("reads an engine that sends nothing — or a mistyped id — as unknown, never healthy (N76)", async () => {
    const { ch } = mockClient({ reporting: [] })
    const result = await engineHealth(ch, { engine: "prod-b" })
    expect(result).toMatchObject({
      status: "unknown",
      engines: ["prod-b"],
      reportingEngines: [],
      silentEngines: ["prod-b"],
    })
  })

  it("degrades a scope in which one engine is silent", async () => {
    const { ch } = mockClient({ reporting: ["prod-a"] })
    const result = await engineHealth(ch, { engine: ["prod-a", "prod-b"] })
    expect(result).toMatchObject({
      status: "degraded",
      reportingEngines: ["prod-a"],
      silentEngines: ["prod-b"],
    })
  })

  it("states its rule in words", () => {
    expect(ENGINE_HEALTH_STATUS_RULE).toBe(
      "From Prometheus, over the engines in scope: unknown when none of them reports metrics; critical only while a severity=critical alert fires for them (fleet-wide also an engine-less CibSeven* alert); degraded with any such firing alert, dead job, open incident or an engine in scope that reports nothing; else healthy.",
    )
  })
})

describe("engineHealth PromQL", () => {
  it("scopes every gauge and the ALERTS series to the engine filter", async () => {
    const { ch, instant } = mockClient()
    await engineHealth(ch, { engine: "prod-a" })
    const sel = '{engine_id="prod-a"}'
    // Every gauge folded over its own labels first: a clustered engine's nodes
    // report the same engine-wide rows.
    const perKey = "max by (process_definition_key, engine_id)"
    expect(instant.mock.calls.map(([q]) => q)).toEqual([
      `sum by (process_definition_key)(${perKey}(camunda_process_instances_running${sel}))`,
      `sum by (incident_type)(max by (process_definition_key, incident_type, engine_id)(camunda_incidents_open${sel}))`,
      `sum(${perKey}(camunda_jobs_failed${sel}))`,
      `max by (engine_id)(camunda_jobs_executable${sel})`,
      `sum(max by (engine_id)(camunda_jobs_suspended${sel}))`,
      `sum(max by (status, engine_id)(camunda_usertasks_open{status="total",engine_id="prod-a"}))`,
      `sum(max by (status, engine_id)(camunda_usertasks_open{status="unassigned",engine_id="prod-a"}))`,
      `max by (engine_id)(camunda_external_tasks_open${sel})`,
      `count(count by (process_definition_key)(${perKey}(camunda_process_definitions_deployed${sel})))`,
      // One engine named: only alerts carrying its engine_id — an unrelated
      // alert in a shared Prometheus cannot turn its verdict critical.
      `ALERTS{alertstate="firing",engine_id="prod-a"}`,
      `ALERTS{alertstate="pending",engine_id="prod-a"}`,
    ])
  })

  it("adds the module's engine-less alerts only for the whole fleet", async () => {
    const { ch, instant } = mockClient()
    await engineHealth(ch, { engine: ["prod-a", "prod-b"], includeFleetAlerts: true })
    const alertQueries = instant.mock.calls.map(([q]) => q).filter((q) => q.startsWith("ALERTS"))
    expect(alertQueries).toEqual([
      'ALERTS{alertstate="firing",engine_id=~"prod-a|prod-b"} or ALERTS{alertstate="firing",alertname=~"CibSeven.+",engine_id=""}',
      'ALERTS{alertstate="pending",engine_id=~"prod-a|prod-b"} or ALERTS{alertstate="pending",alertname=~"CibSeven.+",engine_id=""}',
    ])
  })

  it("reads only the module's own rules when unscoped — never a shared Prometheus' foreign alerts", async () => {
    const { ch, instant } = mockClient()
    await engineHealth(ch, {})
    const alertQueries = instant.mock.calls.map(([q]) => q).filter((q) => q.startsWith("ALERTS"))
    expect(alertQueries).toEqual([
      'ALERTS{alertstate="firing",alertname=~"CibSeven.+"}',
      'ALERTS{alertstate="pending",alertname=~"CibSeven.+"}',
    ])
  })
})
