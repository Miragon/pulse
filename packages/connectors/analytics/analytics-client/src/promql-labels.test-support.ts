// `sum by (a)(sum by (b)(x))` fails even when `a` is declared on `x`: labels propagate the way PromQL evaluates.

import {
  parsePromql,
  type Grouping,
  type Matcher,
  type PromNode,
  type VectorMatching,
} from "./promql-parse.test-support.js"

export interface SeriesInfo {
  labels: readonly string[]
  knownValues?: Readonly<Record<string, readonly string[]>>
}

export type SeriesCatalog = (series: string) => SeriesInfo | undefined

export interface ContractMetricLike {
  promName: string
  type: string
  labels: string[]
  knownValues?: Record<string, string[]>
}

// The bare histogram name is absent: classic histograms expose no such series.
export function contractCatalog(
  metrics: readonly ContractMetricLike[],
  extra: Readonly<Record<string, SeriesInfo>> = {},
): SeriesCatalog {
  const series = new Map<string, SeriesInfo>(Object.entries(extra))
  for (const m of metrics) {
    const info: SeriesInfo = { labels: m.labels, knownValues: m.knownValues }
    if (m.type !== "histogram") {
      series.set(m.promName, info)
      continue
    }
    series.set(`${m.promName}_sum`, info)
    series.set(`${m.promName}_count`, info)
    series.set(`${m.promName}_bucket`, { ...info, labels: [...m.labels, "le"] })
  }
  return (name) => series.get(name)
}

type Scope =
  | { kind: "vector"; labels: ReadonlySet<string>; series: readonly string[] }
  | { kind: "scalar" }
  | { kind: "string"; value: string }

type VectorScope = Extract<Scope, { kind: "vector" }>

const vector = (labels: Iterable<string>, series: readonly string[]): VectorScope => ({
  kind: "vector",
  labels: new Set(labels),
  series,
})

const isVector = (s: Scope): s is VectorScope => s.kind === "vector"

/** Functions whose result keeps the label set of their (first) vector argument. */
const LABEL_PRESERVING = new Set(
  [
    "abs ceil changes clamp clamp_max clamp_min delta deriv exp floor idelta increase irate ln",
    "log10 log2 predict_linear rate resets round sgn sort sort_desc sqrt timestamp",
    "avg_over_time count_over_time last_over_time max_over_time min_over_time present_over_time",
    "quantile_over_time stddev_over_time stdvar_over_time sum_over_time",
  ]
    .join(" ")
    .split(" "),
)

/** Aggregators that return a subset of their input series, labels intact. */
const SAMPLE_SELECTING = new Set(["topk", "bottomk", "limitk", "limit_ratio"])

const isWildcard = (alt: string) => alt === ".*" || alt === ".+" || alt.startsWith("$")

export interface LabelCheck {
  violations: string[]
  series: string[]
  /** Label references verified — lets a caller detect a silently empty scan. */
  checkedLabels: number
  resultLabels: string[] | undefined
}

class LabelChecker {
  readonly violations: string[] = []
  readonly series = new Set<string>()
  checkedLabels = 0

  constructor(private readonly catalog: SeriesCatalog) {}

  private fail(message: string): void {
    this.violations.push(message)
  }

  private requireLabel(scope: VectorScope, label: string, context: string): void {
    this.checkedLabels++
    if (scope.labels.has(label)) return
    this.fail(
      `${context}: "${label}" is not a label of ${describeSeries(scope)} ` +
        `(available: ${[...scope.labels].sort().join(", ") || "none"})`,
    )
  }

  eval(node: PromNode): Scope {
    switch (node.type) {
      case "number":
        return { kind: "scalar" }
      case "string":
        return { kind: "string", value: node.value }
      case "selector":
        return this.evalSelector(node)
      case "call":
        return this.evalCall(node)
      case "aggregate":
        return this.evalAggregate(node)
      case "binary":
        return this.evalBinary(node)
    }
  }

  private evalSelector(node: Extract<PromNode, { type: "selector" }>): Scope {
    if (!node.name) {
      this.fail("selector without a metric name — not supported")
      return vector([], [])
    }
    this.series.add(node.name)
    const info = this.catalog(node.name)
    if (!info) {
      this.fail(`"${node.name}" is neither a contract series nor an allowlisted one`)
      return vector([], [node.name])
    }
    const scope = vector(info.labels, [node.name])
    for (const m of node.matchers) {
      if (m.label === "__name__") continue
      this.requireLabel(scope, m.label, `selector ${node.name}{${m.label}${m.op}"${m.value}"}`)
      this.checkKnownValues(node.name, info, m)
    }
    return scope
  }

  private checkKnownValues(series: string, info: SeriesInfo, m: Matcher): void {
    const known = info.knownValues?.[m.label]
    if (!known) return
    const values = m.op === "=~" || m.op === "!~" ? m.value.split("|") : [m.value]
    for (const value of values.filter((v) => !isWildcard(v))) {
      if (known.includes(value)) continue
      this.fail(
        `selector ${series}{${m.label}${m.op}"${m.value}"}: "${value}" is not a knownValue ` +
          `of ${m.label} (${known.join(", ")})`,
      )
    }
  }

  private evalCall(node: Extract<PromNode, { type: "call" }>): Scope {
    const args = node.args.map((a) => this.eval(a))
    const firstVector = args.find(isVector)
    if (node.func === "histogram_quantile") return this.evalHistogramQuantile(args[1])
    if (LABEL_PRESERVING.has(node.func) && firstVector) return firstVector
    if (node.func === "vector") return vector([], [])
    this.fail(`unsupported function ${node.func}() — extend promql-labels.test-support.ts`)
    return firstVector ?? { kind: "scalar" }
  }

  private evalHistogramQuantile(arg: Scope | undefined): Scope {
    if (!arg || !isVector(arg)) {
      this.fail("histogram_quantile() needs a bucket vector as its second argument")
      return vector([], [])
    }
    this.requireLabel(arg, "le", "histogram_quantile()")
    return vector(
      [...arg.labels].filter((l) => l !== "le"),
      arg.series,
    )
  }

  private evalAggregate(node: Extract<PromNode, { type: "aggregate" }>): Scope {
    const param = node.param ? this.eval(node.param) : undefined
    const inner = this.eval(node.expr)
    if (!isVector(inner)) {
      this.fail(`${node.op}() over a non-vector expression`)
      return vector([], [])
    }
    const g = node.grouping
    for (const label of g?.labels ?? []) {
      this.requireLabel(inner, label, `${node.op} ${g?.mode} (${label})`)
    }
    const labels = aggregateLabels(node.op, inner, g)
    if (node.op === "count_values" && param?.kind === "string") labels.add(param.value)
    return vector(labels, inner.series)
  }

  private evalBinary(node: Extract<PromNode, { type: "binary" }>): Scope {
    const lhs = this.eval(node.lhs)
    const rhs = this.eval(node.rhs)
    if (!isVector(lhs) || !isVector(rhs)) {
      if (node.matching) this.fail(`vector matching on "${node.op}" with a scalar operand`)
      if (isVector(lhs)) return lhs
      return isVector(rhs) ? rhs : { kind: "scalar" }
    }
    const m = node.matching
    if (m) this.checkMatching(node.op, m, lhs, rhs)
    return vector(binaryLabels(node.op, m, lhs, rhs), [...lhs.series, ...rhs.series])
  }

  private checkMatching(op: string, m: VectorMatching, lhs: VectorScope, rhs: VectorScope): void {
    for (const label of m.labels) {
      if (m.mode === "on") {
        // Matching on a label one side lacks pairs everything with "" — a bug.
        this.requireLabel(lhs, label, `${op} on (${label}), left side`)
        this.requireLabel(rhs, label, `${op} on (${label}), right side`)
        continue
      }
      this.checkedLabels++
      if (!lhs.labels.has(label) && !rhs.labels.has(label)) {
        this.fail(
          `${op} ignoring (${label}): "${label}" is a label of neither ` +
            `${describeSeries(lhs)} nor ${describeSeries(rhs)}`,
        )
      }
    }
    // group_x(include) copies labels from the "one" side.
    const one = m.group === "group_left" ? rhs : lhs
    for (const label of m.include) this.requireLabel(one, label, `${op} ${m.group} (${label})`)
  }
}

function describeSeries(scope: VectorScope): string {
  const names = [...new Set(scope.series)]
  return names.length ? names.join(" / ") : "the expression"
}

function aggregateLabels(op: string, inner: VectorScope, g: Grouping | undefined): Set<string> {
  if (SAMPLE_SELECTING.has(op)) return new Set(inner.labels)
  if (!g) return new Set()
  if (g.mode === "by") return new Set(g.labels.filter((l) => inner.labels.has(l)))
  return new Set([...inner.labels].filter((l) => !g.labels.includes(l)))
}

/** Result labels of a vector/vector operation (Prometheus' `resultMetric`). */
function binaryLabels(
  op: string,
  m: VectorMatching | undefined,
  lhs: VectorScope,
  rhs: VectorScope,
): Set<string> {
  if (op === "or") return new Set([...lhs.labels, ...rhs.labels])
  if (op === "and" || op === "unless") return new Set(lhs.labels)
  if (m?.group === "group_left") return new Set([...lhs.labels, ...m.include])
  if (m?.group === "group_right") return new Set([...rhs.labels, ...m.include])
  if (m?.mode === "on") return new Set([...lhs.labels].filter((l) => m.labels.includes(l)))
  if (m?.mode === "ignoring") return new Set([...lhs.labels].filter((l) => !m.labels.includes(l)))
  return new Set(lhs.labels)
}

export function checkQueryLabels(query: string, catalog: SeriesCatalog): LabelCheck {
  const checker = new LabelChecker(catalog)
  const result = checker.eval(parsePromql(query))
  return {
    violations: checker.violations,
    series: [...checker.series],
    checkedLabels: checker.checkedLabels,
    resultLabels: isVector(result) ? [...result.labels].sort() : undefined,
  }
}
