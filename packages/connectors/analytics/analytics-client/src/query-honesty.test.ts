import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { RETENTION_DAYS, type PrometheusClient } from "./prometheus.js"
import * as queries from "./queries/index.js"
import type { CompareKpiDelta } from "./queries/index.js"
import {
  SCENARIOS,
  exportedQueryFunctions,
  recordingClient,
} from "./query-scenarios.test-support.js"

const NOW = Date.parse("2026-10-09T12:00:00Z")
const NOW_SECONDS = NOW / 1000
const RETENTION_SECONDS = RETENTION_DAYS * 86_400

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW })
})

afterAll(() => {
  vi.useRealTimers()
})

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400, w: 604_800 }

function windowsOf(promql: string): Array<{ from: number; to: number; text: string }> {
  return [...promql.matchAll(/\[(\d+)([smhdw])\](?:\s*@\s*(\d+))?/g)].map((m) => {
    const to = m[3] === undefined ? NOW_SECONDS : Number(m[3])
    return { from: to - Number(m[1]) * UNIT_SECONDS[m[2]], to, text: m[0] }
  })
}

describe("query honesty — time windows", () => {
  it.each(Object.entries(SCENARIOS))(
    "%s reads only windows inside [now − retention, now]",
    async (_name, scenarios) => {
      const outside: string[] = []
      for (const run of scenarios) {
        const { ch, sent } = recordingClient()
        await run(ch)
        for (const promql of sent) {
          for (const w of windowsOf(promql)) {
            if (w.to > NOW_SECONDS) outside.push(`future anchor ${w.text}: ${promql}`)
            if (w.from < NOW_SECONDS - RETENTION_SECONDS) {
              outside.push(`past retention ${w.text}: ${promql}`)
            }
            if (w.to <= w.from) outside.push(`empty window ${w.text}: ${promql}`)
          }
        }
      }
      expect(outside).toEqual([])
    },
  )
})

type Result<K extends keyof typeof queries> = Awaited<ReturnType<(typeof queries)[K]>>

// A total map over `queries`: a new export has to state its no-data shape.
const NO_DATA: { [K in keyof typeof queries]: (result: Result<K>) => void } = {
  analyzePerformance: (r) => {
    expect(r.kpi).toBeNull()
    expect(r.activityBreakdown).toEqual([])
  },
  comparePeriods: (r) => {
    for (const k of r.kpiComparison) {
      expect(k).toMatchObject({
        total_instances: 0,
        incident_rate_pct: null,
        avg_duration_sec: null,
        median_sec: null,
        p95_sec: null,
      })
    }
  },
  findFailedInstances: (r) => expect(r.patterns).toEqual([]),
  elementBottleneck: (r) => expect(r.activities).toEqual([]),
  elementHeat: (r) =>
    expect({ frequency: r.frequency, durationSec: r.durationSec }).toEqual({
      frequency: {},
      durationSec: {},
    }),
  clusterCompare: (r) => {
    expect(r.suppressed).toBe(true)
    expectUnmeasuredCompare(r.kpis, r.delta)
  },
  versionCompare: (r) => {
    expect(r.suppressed).toBe(true)
    expectUnmeasuredCompare(r.kpis, r.delta)
  },
  engineCompare: (r) => {
    expect(r.suppressed).toBe(true)
    expectUnmeasuredCompare(r.kpis, r.delta)
  },
  engineLandscape: (r) => {
    expect(r.engines.every((e) => !e.reporting)).toBe(true)
    // A silent engine's counts are unknown, never a row of plausible zeros.
    for (const e of r.engines) {
      expect(e).toMatchObject({ runningInstances: null, openIncidents: null, executableJobs: null })
    }
    expect(r.totals).toMatchObject({
      reportingEngineCount: 0,
      runningInstances: null,
      openIncidents: null,
      failedJobs: null,
    })
  },
  dashboardData: (r) => {
    expect(r).toMatchObject({
      totalCount: 0,
      incidentRatePct: null,
      avgDurationMs: null,
      medianDurationMs: null,
      p95DurationMs: null,
      // No engine in scope reports: the live gauges are "not reported", never 0 running.
      runningNow: null,
      openIncidentsNow: null,
      activityBreakdown: [],
      activityCount: 0,
      definitionBreakdown: [],
    })
    // Nothing started before either: no rate to judge against, and no verdict.
    expect(r.previous).toMatchObject({ totalCount: 0, incidentRatePct: null, suppressed: true })
  },
  failureDashboardData: (r) => {
    expect(r).toMatchObject({ totalIncidents: 0, mostAffectedProcess: null, errorPatterns: [] })
  },
  engineHealth: (r) => {
    // Silence is not health.
    expect(r.status).toBe("unknown")
    expect(r.reportingEngines).toEqual([])
    expect(r.silentEngines).toEqual(r.engines ?? [])
  },
}

function expectUnmeasuredCompare(
  kpis: ReadonlyArray<{
    avg_duration_sec: number | null
    p95_duration_sec: number | null
    incident_rate_pct: number | null
  }>,
  delta: CompareKpiDelta,
) {
  for (const k of kpis) {
    // "Nothing ended" is no 0 s duration, "nothing started" no 0 % rate.
    expect(k.avg_duration_sec).toBeNull()
    expect(k.p95_duration_sec).toBeNull()
    expect(k.incident_rate_pct).toBeNull()
  }
  // …so no delta against them either — never a −100 % from a missing value.
  expect(Object.values(delta).every((v) => v === null)).toBe(true)
}

describe("query honesty — a Prometheus without data", () => {
  it("states a no-data shape for every exported query function", () => {
    expect(Object.keys(NO_DATA).sort()).toEqual(exportedQueryFunctions().sort())
  })

  it.each(Object.entries(SCENARIOS))(
    "%s reports unknown / not measured, never a healthy zero",
    async (name, scenarios) => {
      const expectNoData = NO_DATA[name as keyof typeof queries] as (result: unknown) => void
      for (const run of scenarios) {
        const { ch } = recordingClient(() => [])
        expectNoData(await run(ch))
      }
    },
  )
})

// The plugin registers per-key gauge rows only for what exists: nothing open means no series, yet a measured 0.
describe("query honesty — a reporting engine with nothing open", () => {
  it("dashboard, failure dashboard, engine health and landscape agree on 0", async () => {
    const { ch } = recordingClient((q) =>
      q.includes("camunda_jobs_executable") || q.includes("camunda_external_tasks_open")
        ? [{ metric: { engine_id: "prod-a" }, value: 0 }]
        : [],
    )
    const engine = "prod-a"
    const [dashboard, failures, health, landscape] = await Promise.all([
      queries.dashboardData(ch, { period: "7d", engine }),
      queries.failureDashboardData(ch, { engine }),
      queries.engineHealth(ch, { engine }),
      queries.engineLandscape(ch, { engine }),
    ])

    expect(health.status).toBe("healthy")
    expect({
      dashboard: dashboard.openIncidentsNow,
      failureDashboard: failures.totalIncidents,
      engineHealth: health.openIncidents,
      landscape: landscape.engines.find((e) => e.engineId === engine)?.openIncidents,
    }).toEqual({ dashboard: 0, failureDashboard: 0, engineHealth: 0, landscape: 0 })
    expect({ dashboard: dashboard.runningNow, engineHealth: health.runningInstances }).toEqual({
      dashboard: 0,
      engineHealth: 0,
    })
  })
})

const FLEET = ["prod-a", "prod-b"]

// A total map: unless a result names its engines, a fleet figure reads as one engine's.
const SCOPE_ECHO: {
  [K in keyof typeof queries]:
    | { echo: (ch: PrometheusClient, engine: string[]) => Promise<{ engines: unknown }> }
    | { exempt: string }
} = {
  analyzePerformance: {
    echo: (ch, engine) =>
      queries.analyzePerformance(ch, {
        processDefinitionKey: "invoice",
        period: "7d",
        includeActivityBreakdown: false,
        engine,
      }),
  },
  comparePeriods: {
    echo: (ch, engine) =>
      queries.comparePeriods(ch, {
        processDefinitionKey: "invoice",
        periodAFrom: "2026-10-01T00:00:00Z",
        periodATo: "2026-10-02T00:00:00Z",
        periodBFrom: "2026-10-02T00:00:00Z",
        periodBTo: "2026-10-03T00:00:00Z",
        includeActivityBreakdown: false,
        engine,
      }),
  },
  findFailedInstances: {
    echo: (ch, engine) => queries.findFailedInstances(ch, { maxResults: 5, engine }),
  },
  elementBottleneck: {
    echo: (ch, engine) =>
      queries.elementBottleneck(ch, {
        processDefinitionKey: "invoice",
        period: "7d",
        minBucketSize: 1,
        maxResults: 5,
        engine,
      }),
  },
  elementHeat: {
    exempt:
      "heatmap values only — its show tool and feed carry the scope in their own payload (analytics-connector engine-scope.test.ts)",
  },
  clusterCompare: {
    echo: (ch, engine) =>
      queries.clusterCompare(ch, {
        deploymentTimestamp: "2026-10-05T00:00:00Z",
        windowBeforeDays: 3,
        windowAfterDays: 3,
        minBucketSize: 1,
        engine,
      }),
  },
  versionCompare: {
    echo: (ch, engine) =>
      queries.versionCompare(ch, {
        processDefinitionKey: "invoice",
        versionA: 1,
        versionB: 2,
        windowDays: 7,
        minBucketSize: 1,
        engine,
      }),
  },
  engineCompare: { exempt: "partitions by exactly engineA and engineB, both echoed" },
  engineLandscape: { exempt: "lists every engine it covers, one row each" },
  dashboardData: {
    echo: (ch, engine) => queries.dashboardData(ch, { period: "7d", engine }),
  },
  failureDashboardData: {
    echo: (ch, engine) => queries.failureDashboardData(ch, { engine }),
  },
  engineHealth: { echo: (ch, engine) => queries.engineHealth(ch, { engine }) },
}

describe("query honesty — every aggregate names the engines it covers", () => {
  it.each(Object.entries(SCOPE_ECHO))("%s", async (_name, rule) => {
    if ("exempt" in rule) return
    const { ch } = recordingClient()
    expect((await rule.echo(ch, FLEET)).engines).toEqual(FLEET)
    // Unscoped library call: `null` = every engine Prometheus holds — never a
    // made-up list, never silently absent.
    expect((await rule.echo(ch, [])).engines).toBeNull()
  })
})

function emptyStrings(value: unknown, path = "$"): string[] {
  if (value === "") return [path]
  if (Array.isArray(value)) return value.flatMap((v, i) => emptyStrings(v, `${path}[${i}]`))
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => emptyStrings(v, `${path}.${k}`))
  }
  return []
}

describe("query honesty — no placeholder fields", () => {
  it.each(Object.entries(SCENARIOS))(
    "%s fills every string field it returns",
    async (_name, scenarios) => {
      for (const run of scenarios) {
        // Every sample carries every label, so an empty string can only be a
        // field no query fills — a placeholder posing as data.
        const { ch } = recordingClient()
        expect(emptyStrings(await run(ch))).toEqual([])
      }
    },
  )
})
