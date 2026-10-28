// Text-level on purpose: the shapes are fixed strings the helpers emit and the alert rules and dashboards copy.

export interface ReadingRuleMetric {
  promName: string
  type: string
  labels: readonly string[]
}

export interface ReadingRuleOptions {
  /** Whether a plain `increase(<range>[ @ <at>])` is allowed; never, when absent. */
  plainIncreaseAllowed?: (range: string, at: number | undefined) => boolean
}

const SERIES = String.raw`camunda_[A-Za-z0-9_]+(?:\{[^}]*\})?`
const RANGE = String.raw`[^\]\s]+`
const OFFSET = String.raw`[^)\s]+`

/**
 * `((increase(S[R]@) and present_over_time(S[1h]@ offset O)) or
 * (max_over_time(S[R]@) unless present_over_time(S[1h]@ offset O)))` — O is
 * the window's range, or the end of its first hour at the retention edge.
 */
const BORN_READ = new RegExp(
  String.raw`\(\(increase\((${SERIES})\[(${RANGE})\]((?: @ \d+)?)\) and present_over_time\(\1\[1h\]\3 offset (${OFFSET})\)\)` +
    String.raw` or \(max_over_time\(\1\[\2\]\3\) unless present_over_time\(\1\[1h\]\3 offset \4\)\)\)`,
  "g",
)

const PLAIN_INCREASE = new RegExp(
  String.raw`increase\((${SERIES})\[(${RANGE})\](?: @ (\d+))?\)`,
  "g",
)

export function readingRuleViolations(
  promql: string,
  metrics: readonly ReadingRuleMetric[],
  options: ReadingRuleOptions = {},
): string[] {
  const violations: string[] = []
  const covered = coveredSpans(promql, options)
  for (const metric of metrics) {
    for (const index of occurrences(promql, metric)) {
      if (metric.type === "gauge") {
        if (!nodeFolded(promql, index, metric.labels)) {
          violations.push(
            `${metric.promName} is not read as max by (${metric.labels.join(", ")})(…) — fold a clustered engine's nodes first`,
          )
        }
      } else if (!covered.some(([from, to]) => index >= from && index < to)) {
        violations.push(
          `${metric.promName} is read outside the born-series count (increaseIn) — increase()/rate() miss a series' first sample`,
        )
      }
    }
  }
  return violations
}

/** The spans counters may appear in: born-series reads, plus the allowed plain increases. */
function coveredSpans(promql: string, options: ReadingRuleOptions): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  for (const m of promql.matchAll(BORN_READ)) spans.push([m.index, m.index + m[0].length])
  for (const m of promql.matchAll(PLAIN_INCREASE)) {
    const inBorn = spans.some(([from, to]) => m.index >= from && m.index < to)
    const at = m[3] === undefined ? undefined : Number(m[3])
    if (!inBorn && options.plainIncreaseAllowed?.(m[2], at)) {
      spans.push([m.index, m.index + m[0].length])
    }
  }
  return spans
}

function occurrences(promql: string, metric: ReadingRuleMetric): number[] {
  const names =
    metric.type === "histogram"
      ? ["_sum", "_count", "_bucket"].map((suffix) => `${metric.promName}${suffix}`)
      : [metric.promName]
  const pattern = new RegExp(String.raw`\b(?:${names.join("|")})(?![A-Za-z0-9_])`, "g")
  return [...promql.matchAll(pattern)].map((m) => m.index)
}

/** Whether the gauge at `index` sits directly inside `max by (<labels>)(`. */
function nodeFolded(promql: string, index: number, labels: readonly string[]): boolean {
  const before = /max\s+by\s*\(([^)]*)\)\s*\(\s*$/.exec(promql.slice(0, index))
  if (!before) return false
  const folded = before[1]
    .split(",")
    .map((label) => label.trim())
    .filter((label) => label !== "")
  return folded.length === labels.length && labels.every((label) => folded.includes(label))
}
