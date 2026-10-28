import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  checkQueryLabels,
  contractCatalog,
  type ContractMetricLike,
  type SeriesCatalog,
} from "./promql-labels.test-support.js"
import { alertExpressions, dashboardQueries } from "./promql-sources.test-support.js"
import { readingRuleViolations } from "./promql-reading-rules.test-support.js"
import { RETENTION_DAYS } from "./prometheus.js"
import { ENGINE_ALERT_NAME_PATTERN } from "./queries/health.js"
import { DAY_SECONDS, nowSeconds, rangeSeconds } from "./queries/windows.js"
import {
  SCENARIOS,
  exportedQueryFunctions,
  recordingClient,
} from "./query-scenarios.test-support.js"

// A text scan cannot see a label that only exists in a composed selector (#327).

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))
const repoRoot = here("../../../../..")

const contract = JSON.parse(readFileSync(here("../metrics-contract.json"), "utf8")) as {
  metrics: ContractMetricLike[]
}

const alertsFile = join(repoRoot, "playground/docker/prometheus/alerts.yml")
const dashboardsDir = join(repoRoot, "playground/docker/grafana/dashboards")

// ALERTS labels derive from alerts.yml, never hand-listed: a rule that stops aggregating by a label drops it here.
const UP_LABELS = ["job", "instance"]
const ALERTS_BASE_LABELS = ["alertname", "alertstate", "severity"]

const ruleCatalog = contractCatalog(contract.metrics, { up: { labels: UP_LABELS } })
const alertsYaml = readFileSync(alertsFile, "utf8")
const alertRules = alertExpressions(alertsYaml)
const alertLabels = new Set([
  ...ALERTS_BASE_LABELS,
  ...alertRules.flatMap((expr) => checkQueryLabels(expr, ruleCatalog).resultLabels ?? []),
])

const catalog: SeriesCatalog = contractCatalog(contract.metrics, {
  up: { labels: UP_LABELS },
  ALERTS: { labels: [...alertLabels] },
})

function violationsOf(origin: string, promql: string): string[] {
  return checkQueryLabels(promql, catalog).violations.map((v) => `${origin}: ${v}\n    ${promql}`)
}

describe("metrics contract — labels each query actually sends", () => {
  it("has a scenario for every exported query function", () => {
    expect(Object.keys(SCENARIOS).sort()).toEqual(exportedQueryFunctions().sort())
  })

  it.each(Object.entries(SCENARIOS))(
    "%s names only labels its series declare",
    async (name, scenarios) => {
      const violations: string[] = []
      let checked = 0
      for (const run of scenarios) {
        const { ch, sent } = recordingClient()
        await run(ch)
        expect(sent.length, `${name} sent no PromQL`).toBeGreaterThan(0)
        for (const promql of sent) {
          violations.push(...violationsOf(name, promql))
          checked += checkQueryLabels(promql, catalog).checkedLabels
        }
      }
      expect(violations).toEqual([])
      // Every query scopes by at least one label (engine, process, …) — 0
      // here means the scenario args or the checker went blind.
      expect(checked, `${name}: no label reference was checked`).toBeGreaterThan(0)
    },
  )
})

describe("metrics contract — labels in alert rules and dashboards", () => {
  it("alert rule expressions name only declared labels", () => {
    expect(alertRules.length).toBeGreaterThan(0)
    // Every `expr:` in the file was extracted — none hides in a YAML shape
    // (flow mapping, …) the extractor does not read.
    expect(alertRules).toHaveLength(alertsYaml.match(/\bexpr:/g)?.length ?? 0)
    expect(alertRules.flatMap((expr) => violationsOf("alerts.yml", expr))).toEqual([])
    for (const expr of alertRules) {
      // A rule that selects no series or yields no vector was not checked —
      // e.g. an expression that parsed as one PromQL string literal.
      const { series, resultLabels } = checkQueryLabels(expr, catalog)
      expect(series, `alerts.yml selects no series: ${expr}`).not.toEqual([])
      expect(resultLabels, `alerts.yml yields no vector: ${expr}`).toBeDefined()
    }
    // The rules aggregate by engine_id — `engineHealth` filters ALERTS on it.
    expect(alertLabels.has("engine_id")).toBe(true)
  })

  it("every shipped alert rule is named so engineHealth recognises it as the module's own", () => {
    // Engine-less alerts (CibSevenEngineNoMetrics) only count when their name
    // matches — a rule outside the pattern would silently drop out of the
    // fleet-wide verdict, and a shared Prometheus' foreign alerts must not count.
    const names = [...alertsYaml.matchAll(/^\s*-\s*alert:\s*(\S+)\s*$/gm)].map((m) => m[1])
    expect(names).toHaveLength(alertRules.length)
    const own = new RegExp(`^(?:${ENGINE_ALERT_NAME_PATTERN})$`)
    expect(names.filter((name) => !own.test(name))).toEqual([])
  })

  it("Grafana dashboard queries name only declared labels", () => {
    const files = readdirSync(dashboardsDir).filter((f) => f.endsWith(".json"))
    expect(files.length).toBeGreaterThan(0)
    let expressions = 0
    const violations: string[] = []
    for (const file of files) {
      const dashboard = JSON.parse(readFileSync(join(dashboardsDir, file), "utf8")) as unknown
      for (const promql of dashboardQueries(dashboard)) {
        expressions++
        violations.push(...violationsOf(`dashboards/${file}`, promql))
        const { series } = checkQueryLabels(promql, catalog)
        expect(series, `dashboards/${file} selects no series: ${promql}`).not.toEqual([])
      }
    }
    expect(expressions).toBeGreaterThan(0)
    expect(violations).toEqual([])
  })
})

describe("metrics contract — reading rules", () => {
  const plainIncreaseAllowed = (range: string, at: number | undefined) => {
    const now = nowSeconds()
    const seconds = rangeSeconds(range)
    return seconds <= 3600 && (at ?? now) - seconds - 3600 < now - RETENTION_DAYS * DAY_SECONDS
  }

  it.each(Object.entries(SCENARIOS))(
    "%s reads counters and gauges by the rules",
    async (name, scenarios) => {
      const violations: string[] = []
      for (const run of scenarios) {
        const { ch, sent } = recordingClient()
        await run(ch)
        for (const promql of sent) {
          violations.push(
            ...readingRuleViolations(promql, contract.metrics, { plainIncreaseAllowed }).map(
              (v) => `${name}: ${v}\n    ${promql}`,
            ),
          )
        }
      }
      expect(violations).toEqual([])
    },
  )

  it("alert rules read counters and gauges by the rules", () => {
    const violations = alertRules.flatMap((expr) =>
      readingRuleViolations(expr, contract.metrics).map((v) => `alerts.yml: ${v}\n    ${expr}`),
    )
    expect(violations).toEqual([])
  })

  it("Grafana panels read counters and gauges by the rules", () => {
    const violations: string[] = []
    for (const file of readdirSync(dashboardsDir).filter((f) => f.endsWith(".json"))) {
      const dashboard = JSON.parse(readFileSync(join(dashboardsDir, file), "utf8")) as unknown
      // Panel expressions only: a templating `label_values(…)` lists label
      // values, it reads no counter or gauge value.
      for (const promql of panelExpressions(dashboard)) {
        violations.push(
          ...readingRuleViolations(promql, contract.metrics).map(
            (v) => `dashboards/${file}: ${v}\n    ${promql}`,
          ),
        )
      }
    }
    expect(violations).toEqual([])
  })
})

function panelExpressions(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(panelExpressions)
  if (node === null || typeof node !== "object") return []
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    key === "expr" && typeof value === "string" ? [value] : panelExpressions(value),
  )
}
