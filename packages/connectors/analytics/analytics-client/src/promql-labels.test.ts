import { describe, expect, it } from "vitest"
import { checkQueryLabels, contractCatalog } from "./promql-labels.test-support.js"
import { parsePromql } from "./promql-parse.test-support.js"

/**
 * The checker behind the selector-label contract guard
 * (`metrics-contract-labels.test.ts`). These cases pin down that each
 * violation class is actually caught: a checker that silently accepts
 * everything would let the guard pass vacuously.
 */

const catalog = contractCatalog(
  [
    {
      promName: "inc_total",
      type: "counter",
      labels: ["process_definition_key", "activity_id", "engine_id"],
    },
    {
      promName: "ended_total",
      type: "counter",
      labels: ["process_definition_key", "process_definition_version", "engine_id", "state"],
      knownValues: { state: ["COMPLETED", "EXTERNALLY_TERMINATED"] },
    },
    {
      promName: "dur_seconds",
      type: "histogram",
      labels: ["process_definition_key", "engine_id"],
    },
    { promName: "backlog", type: "gauge", labels: ["engine_id"] },
  ],
  { ALERTS: { labels: ["alertname", "alertstate", "engine_id"] } },
)

const check = (query: string) => checkQueryLabels(query, catalog)
const violations = (query: string) => check(query).violations

describe("checkQueryLabels: accepted shapes", () => {
  it.each([
    'sum(increase(inc_total{process_definition_key="k",engine_id=~"a|b"}[7d]))',
    "sum by (activity_id)(increase(inc_total[86400s] @ 1700000000))",
    'histogram_quantile(0.95, sum by (le)(increase(dur_seconds_bucket{engine_id="a"}[7d])))',
    "sum(increase(dur_seconds_sum[7d])) / sum(increase(dur_seconds_count[7d]))",
    'sum(increase(ended_total{state="COMPLETED"}[7d]))',
    "sum by (engine_id) (rate(ended_total[15m])) == 0 and sum by (engine_id) (backlog) > 0",
    'ALERTS{alertstate="firing",engine_id="a"}',
    "count by (engine_id)(inc_total)",
    'sum by (engine_id) (rate(inc_total{engine_id=~"$engine_id"}[$__rate_interval]))',
    "sum(rate(inc_total[5m])) * 60",
    "-sum(inc_total offset 1h)",
    "topk(3, sum by (activity_id)(inc_total))",
    "inc_total / on (engine_id) group_left (process_definition_version) ended_total",
  ])("%s", (query) => {
    expect(violations(query)).toEqual([])
  })

  it("counts every label reference it verifies", () => {
    const result = check('sum by (activity_id)(inc_total{engine_id="a",activity_id="x"})')
    expect(result.checkedLabels).toBe(3)
    expect(result.series).toEqual(["inc_total"])
    expect(result.resultLabels).toEqual(["activity_id"])
  })
})

describe("checkQueryLabels: violations", () => {
  it("flags a matcher label the series does not declare (the version-compare bug)", () => {
    const [v, ...rest] = violations(
      'sum(increase(inc_total{process_definition_key="k",process_definition_version="2"}[7d]))',
    )
    expect(rest).toEqual([])
    expect(v).toContain('"process_definition_version" is not a label of inc_total')
  })

  it("flags a by-label the aggregated series does not declare", () => {
    expect(violations("sum by (state)(increase(inc_total[7d]))")).toEqual([
      expect.stringContaining('sum by (state): "state" is not a label of inc_total'),
    ])
  })

  it("tracks label narrowing through nested aggregations", () => {
    expect(violations("sum by (activity_id)(sum by (process_definition_key)(inc_total))")).toEqual([
      expect.stringContaining('"activity_id" is not a label of inc_total'),
    ])
  })

  it("flags without-labels the operand does not carry", () => {
    expect(violations("sum without (state)(inc_total)")).toHaveLength(1)
    expect(check("sum without (activity_id)(inc_total)").resultLabels).toEqual([
      "engine_id",
      "process_definition_key",
    ])
  })

  it("flags unknown series, including a bare histogram name", () => {
    expect(violations("sum(nope_total)")).toEqual([
      expect.stringContaining('"nope_total" is neither a contract series'),
    ])
    expect(violations("sum(dur_seconds)")).toHaveLength(1)
  })

  it("requires le for histogram_quantile and consumes it", () => {
    expect(violations("histogram_quantile(0.5, sum by (engine_id)(dur_seconds_bucket))")).toEqual([
      expect.stringContaining('histogram_quantile(): "le" is not a label'),
    ])
    expect(check("histogram_quantile(0.5, dur_seconds_bucket)").resultLabels).toEqual([
      "engine_id",
      "process_definition_key",
    ])
    expect(violations("histogram_quantile(0.5)")).toHaveLength(1)
  })

  it("checks on/ignoring/group_left/group_right label lists against both operands", () => {
    expect(violations("inc_total / on (activity_id) backlog")).toEqual([
      expect.stringContaining("on (activity_id), right side"),
    ])
    expect(violations("inc_total / ignoring (state) backlog")).toEqual([
      expect.stringContaining('"state" is a label of neither inc_total nor backlog'),
    ])
    expect(violations("inc_total * on (engine_id) group_left (state) backlog")).toEqual([
      expect.stringContaining('group_left (state): "state" is not a label of backlog'),
    ])
    expect(violations("backlog * on (engine_id) group_right (state) inc_total")).toEqual([
      expect.stringContaining('group_right (state): "state" is not a label of backlog'),
    ])
    expect(violations("inc_total + on (engine_id) 1")).toHaveLength(1)
  })

  it("flags hardcoded values outside the documented knownValues", () => {
    expect(violations('ended_total{state="DONE"}')).toEqual([
      expect.stringContaining('"DONE" is not a knownValue of state'),
    ])
    expect(violations('ended_total{state=~"COMPLETED|DONE|.*"}')).toHaveLength(1)
  })

  it("reports unsupported functions and name-less selectors instead of passing them", () => {
    expect(violations('label_replace(inc_total, "x", "$1", "activity_id", "(.*)")')).toEqual([
      expect.stringContaining("unsupported function label_replace()"),
    ])
    expect(violations('{engine_id="a"}')).toEqual([
      expect.stringContaining("selector without a metric name"),
    ])
    expect(violations('{__name__="backlog",engine_id="a"}')).toEqual([])
    expect(violations("sum(1)")).toEqual([expect.stringContaining("non-vector")])
  })
})

describe("checkQueryLabels: result labels", () => {
  it.each([
    ["inc_total or backlog", ["activity_id", "engine_id", "process_definition_key"]],
    ["backlog unless inc_total", ["engine_id"]],
    ["inc_total / on (engine_id) backlog", ["engine_id"]],
    ["inc_total / ignoring (activity_id) inc_total", ["engine_id", "process_definition_key"]],
    [
      "backlog * on (engine_id) group_right inc_total",
      ["activity_id", "engine_id", "process_definition_key"],
    ],
    ['count_values("value", backlog)', ["value"]],
    ["vector(1)", []],
    ["2 * backlog", ["engine_id"]],
  ])("%s → %j", (query, labels) => {
    expect(check(query).resultLabels).toEqual(labels)
  })

  it("has no result labels for a scalar expression", () => {
    expect(check("1 + 2").resultLabels).toBeUndefined()
  })
})

describe("parsePromql", () => {
  it("folds parentheses, unary signs and range/offset/@ postfixes into the operand", () => {
    expect(parsePromql("(-inc_total[5m] offset 1h @ start())")).toEqual({
      type: "selector",
      name: "inc_total",
      matchers: [],
    })
    // Grafana interpolates its interval variables as durations, offsets included.
    expect(parsePromql("inc_total[1h] @ 1700000000 offset $__range")).toEqual({
      type: "selector",
      name: "inc_total",
      matchers: [],
    })
  })

  it("parses grouping after the aggregation body and binds ^ right-associatively", () => {
    expect(parsePromql("sum(inc_total) by (engine_id)")).toMatchObject({
      type: "aggregate",
      grouping: { mode: "by", labels: ["engine_id"] },
    })
    expect(parsePromql("1 ^ 2 ^ 3")).toMatchObject({ rhs: { type: "binary", op: "^" } })
    expect(parsePromql("1 - 2 * 3")).toMatchObject({ op: "-", rhs: { op: "*" } })
  })

  it("unescapes label values", () => {
    expect(parsePromql('x{a="q\\"uote",b=`raw\\`}')).toMatchObject({
      matchers: [
        { label: "a", value: 'q"uote' },
        { label: "b", value: "raw\\" },
      ],
    })
  })

  it.each([
    "sum(inc_total",
    "inc_total{engine_id}",
    'inc_total{engine_id=="a"}',
    "inc_total @ now",
    "sum by engine_id (inc_total)",
    "sum()",
    "inc_total )",
    "inc_total # comment",
  ])("rejects %s", (query) => {
    expect(() => parsePromql(query)).toThrow(/PromQL:/)
  })
})
