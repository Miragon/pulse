import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { GAUGE_LABELS, METRIC_NAMES } from "./metric-names.js"

interface ContractMetric {
  otelName: string
  promName: string
  type: "counter" | "histogram" | "gauge"
  unit: string
  labels: string[]
  knownValues?: Record<string, string[]>
  buckets?: number[]
}

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))

const contract = JSON.parse(readFileSync(here("../metrics-contract.json"), "utf8")) as {
  metrics: ContractMetric[]
}

/**
 * Every label a contract metric carries. The series share their prefix with the `engine_id` label
 * (`by (engine_id)`, `{engine_id="…"}`), so a series scan skips exactly these and reads every
 * other `engine_…` token as a series.
 */
const CONTRACT_LABELS = new Set(contract.metrics.flatMap((m) => m.labels))

const extractSeries = (text: string) =>
  [...new Set(text.match(/engine_[a-zA-Z0-9_]+/g) ?? [])].filter((s) => !CONTRACT_LABELS.has(s))

/** Strip block and line comments: doc comments may legitimately mention series names. */
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n")

const resolveMetricInterpolations = (code: string) =>
  code.replace(
    /\$\{(?:M|METRIC_NAMES)\.([A-Za-z0-9_]+)\}|\b(?:M|METRIC_NAMES)\.([A-Za-z0-9_]+)/g,
    (_, braced?: string, bare?: string) => {
      const key = braced ?? bare ?? ""
      const name = (METRIC_NAMES as Record<string, string>)[key]
      if (name === undefined) throw new Error(`unknown METRIC_NAMES key "${key}"`)
      return name
    },
  )

interface ConsumerSource {
  name: string
  text: string
}

const queriesDir = here("./queries")

const querySources = (): ConsumerSource[] =>
  readdirSync(queriesDir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => ({
      name: `queries/${f}`,
      text: resolveMetricInterpolations(stripComments(readFileSync(join(queriesDir, f), "utf8"))),
    }))

/**
 * No query pins a known label value through a regex selector, so this line keeps the regex scan
 * below proven (it read the playground's Grafana dashboard until that went).
 */
const REGEX_SELECTOR_PROBE: ConsumerSource = {
  name: "regex selector probe",
  text: `${METRIC_NAMES.userTasksOpen}{status=~"total|unassigned"}`,
}

describe("metrics contract", () => {
  it("declares well-formed metrics", () => {
    expect(contract.metrics.length).toBeGreaterThan(0)
    for (const m of contract.metrics) {
      expect(m.otelName, m.promName).toMatch(/^engine\.[a-z._]+$/)
      expect(["counter", "histogram", "gauge"]).toContain(m.type)
      expect(m.labels.length, `${m.promName} must carry engine_id`).toBeGreaterThan(0)
      expect(m.labels).toContain("engine_id")
      for (const label of Object.keys(m.knownValues ?? {})) {
        expect(m.labels, `knownValues key ${label} of ${m.promName}`).toContain(label)
      }
      if (m.type === "histogram") {
        expect(m.unit, `${m.promName} unit`).toBe("ms")
        expect(m.promName, m.otelName).toMatch(/_milliseconds$/)
        const buckets = m.buckets ?? []
        expect(buckets.length, `${m.promName} declares its buckets`).toBeGreaterThan(0)
        expect(
          buckets.every((b, i) => Number.isInteger(b) && b > 0 && (i === 0 || b > buckets[i - 1])),
          `${m.promName} buckets are ascending whole ms`,
        ).toBe(true)
      } else {
        expect(m.unit, `${m.promName} unit`).toBe("")
        expect(m.buckets, `${m.promName} is no histogram`).toBeUndefined()
      }
    }
  })

  it("GAUGE_LABELS mirrors every gauge's contract labels exactly", () => {
    const gauges = contract.metrics.filter((m) => m.type === "gauge")
    expect(Object.keys(GAUGE_LABELS).sort()).toEqual(gauges.map((m) => m.promName).sort())
    for (const m of gauges) {
      expect([...GAUGE_LABELS[m.promName as keyof typeof GAUGE_LABELS]].sort(), m.promName).toEqual(
        [...m.labels].sort(),
      )
    }
  })

  it("METRIC_NAMES mirrors the contract exactly", () => {
    const contractNames = contract.metrics.map((m) => m.promName).sort()
    const constNames = Object.values<string>(METRIC_NAMES).sort()
    expect(constNames).toEqual(contractNames)
  })

  it("query sources contain no raw engine_* literals (METRIC_NAMES only)", () => {
    const sources = readdirSync(queriesDir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    )
    expect(sources.length).toBeGreaterThan(0)
    for (const file of sources) {
      const code = stripComments(readFileSync(join(queriesDir, file), "utf8"))
      const literals = extractSeries(code)
      expect(literals, `queries/${file} must use METRIC_NAMES`).toEqual([])
    }
  })

  it("hardcoded label values in queries are declared knownValues", () => {
    const sources = [...querySources(), REGEX_SELECTOR_PROBE]

    const knownValues = new Map<string, Set<string>>()
    for (const m of contract.metrics) {
      for (const [label, values] of Object.entries(m.knownValues ?? {})) {
        const set = knownValues.get(label) ?? new Set<string>()
        values.forEach((v) => set.add(v))
        knownValues.set(label, set)
      }
    }
    expect(knownValues.size).toBeGreaterThan(0)

    const isWildcard = (alt: string) => alt === ".*" || alt === ".+" || alt.startsWith("$")

    let exactChecked = 0
    let regexChecked = 0
    for (const [label, values] of knownValues) {
      // The lookbehind keeps `alertstate="firing"` from matching the `state` label.
      const exact = new RegExp(`(?<![A-Za-z_])${label}="([A-Za-z_][A-Za-z0-9_]*)"`, "g")
      // Regex selectors (`label=~"total|unassigned"`): every alternative must
      // be a knownValue, except wildcards (`.*`/`.+`) and `$` variables.
      const regexSel = new RegExp(`(?<![A-Za-z_])${label}=~"([^"]*)"`, "g")
      for (const { name, text } of sources) {
        for (const match of text.matchAll(exact)) {
          exactChecked++
          expect(values.has(match[1]), `${label}="${match[1]}" (${name}) not in knownValues`).toBe(
            true,
          )
        }
        for (const match of text.matchAll(regexSel)) {
          for (const alt of match[1].split("|")) {
            if (isWildcard(alt)) continue
            regexChecked++
            expect(
              /^[A-Za-z_][A-Za-z0-9_]*$/.test(alt),
              `${label}=~"${match[1]}" (${name}): alternative "${alt}" is neither a plain value nor a recognised wildcard. Extend the parser if the pattern is legitimate`,
            ).toBe(true)
            expect(
              values.has(alt),
              `${label}=~"${match[1]}" (${name}): "${alt}" not in knownValues`,
            ).toBe(true)
          }
        }
      }
    }
    expect(exactChecked).toBeGreaterThan(0)
    // The probe pins `status=~"total|unassigned"`. If this reads 0 the
    // regex-matcher scan silently broke.
    expect(regexChecked).toBeGreaterThan(0)
  })

  it("reads the engine_id label as no series, and every other engine_ token as one", () => {
    const query =
      'sum by (engine_id) (max by (process_definition_key, engine_id) (engine_jobs_failed{engine_id="$engine_id"}))'
    expect(extractSeries(query)).toEqual(["engine_jobs_failed"])
    // A series the contract does not hold still reads as one, so the literal check above fails on it.
    const unknown = "sum by (engine_id) (increase(engine_unknown_total[5m]))"
    expect(extractSeries(unknown)).toEqual(["engine_unknown_total"])
  })

  it("every contract metric has at least one consumer (the queries)", () => {
    // Emitted by the engine plugin but read by no query: the user-task series
    // (the duration fed only the playground's Grafana dashboard, which went with
    // the playground's Prometheus). Remove an entry from this allowlist the
    // moment a consumer appears: the stale-entry check below fails to remind
    // you. Do NOT add new entries without the same rationale.
    const KNOWN_UNCONSUMED = new Set([
      "engine_usertask_created_total",
      "engine_usertask_completed_total",
      "engine_usertask_duration_milliseconds",
    ])

    const used = new Set(querySources().flatMap(({ text }) => extractSeries(text)))

    for (const m of contract.metrics) {
      const series =
        m.type === "histogram"
          ? [m.promName, `${m.promName}_sum`, `${m.promName}_count`, `${m.promName}_bucket`]
          : [m.promName]
      const consumed = series.some((s) => used.has(s))
      if (KNOWN_UNCONSUMED.has(m.promName)) {
        expect(consumed, `${m.promName} is consumed now; remove it from KNOWN_UNCONSUMED`).toBe(
          false,
        )
      } else {
        expect(consumed, `${m.promName} has no consumer (TS queries). Dead contract entry?`).toBe(
          true,
        )
      }
    }
  })
})
