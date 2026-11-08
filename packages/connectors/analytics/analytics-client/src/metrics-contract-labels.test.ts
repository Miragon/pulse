import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  checkQueryLabels,
  contractCatalog,
  type ContractMetricLike,
  type SeriesCatalog,
} from "./promql-labels.test-support.js"
import { readingRuleViolations } from "./promql-reading-rules.test-support.js"
import { RETENTION_DAYS } from "./prometheus.js"
import { DAY_SECONDS, nowSeconds, rangeSeconds } from "./queries/windows.js"
import {
  SCENARIOS,
  exportedQueryFunctions,
  recordingClient,
} from "./query-scenarios.test-support.js"

// A text scan cannot see a label that only exists in a composed selector (#327).

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))

const contract = JSON.parse(readFileSync(here("../metrics-contract.json"), "utf8")) as {
  metrics: ContractMetricLike[]
}

const UP_LABELS = ["job", "instance"]
// ALERTS carries Prometheus' own labels and the scope labels engineHealth reads from an alert (its
// engine filter, the process and the incident type). They derived from the playground's alert
// rules until those went with its Prometheus; a rule of yours aggregates by the same.
const ALERTS_LABELS = [
  "alertname",
  "alertstate",
  "severity",
  "engine_id",
  "process_definition_key",
  "incident_type",
]

const catalog: SeriesCatalog = contractCatalog(contract.metrics, {
  up: { labels: UP_LABELS },
  ALERTS: { labels: ALERTS_LABELS },
})

function violationsOf(origin: string, promql: string): string[] {
  return checkQueryLabels(promql, catalog).violations.map((v) => `${origin}: ${v}\n    ${promql}`)
}

describe("metrics contract: labels each query actually sends", () => {
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
      // Every query scopes by at least one label (engine, process, …): 0
      // here means the scenario args or the checker went blind.
      expect(checked, `${name}: no label reference was checked`).toBeGreaterThan(0)
    },
  )
})

describe("metrics contract: reading rules", () => {
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
})
