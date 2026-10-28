import { describe, expect, it } from "vitest"
import { checkQueryLabels, contractCatalog } from "./promql-labels.test-support.js"
import { alertExpressions, dashboardQueries } from "./promql-sources.test-support.js"

const catalog = contractCatalog([
  { promName: "backlog", type: "gauge", labels: ["engine_id"] },
  { promName: "started_total", type: "counter", labels: ["engine_id", "state"] },
])

describe("alertExpressions", () => {
  it.each([
    ["plain", "    expr: sum by (engine_id) (backlog) > 0"],
    ["single-quoted", "    expr: 'sum by (engine_id) (backlog) > 0'"],
    ["double-quoted", '    expr: "sum by (engine_id) (backlog) > 0"'],
    ["a list item", "  - expr: sum by (engine_id) (backlog) > 0"],
    ["a literal block", "    expr: |\n      sum by (engine_id) (backlog)\n\n        > 0"],
    ["a folded block", "    expr: >-\n      sum by (engine_id)\n      (backlog) > 0"],
    ["a plain multi-line scalar", "    expr: sum by (engine_id)\n      (backlog) > 0"],
    ["a quoted multi-line scalar", "    expr: 'sum by (engine_id)\n      (backlog) > 0'"],
  ])("reads %s expr as the PromQL it denotes", (_shape, yaml) => {
    const [expr] = alertExpressions(`${yaml}\n    for: 5m\n`)
    expect(expr.replace(/\s+/g, " ")).toBe("sum by (engine_id) (backlog) > 0")
  })

  it("unescapes quotes inside quoted scalars", () => {
    expect(alertExpressions(`    expr: 'backlog{engine_id=''a''}'`)).toEqual([
      "backlog{engine_id='a'}",
    ])
    expect(alertExpressions(`    expr: "backlog{engine_id=\\"a\\"}"`)).toEqual([
      'backlog{engine_id="a"}',
    ])
  })

  it("lets the checker see the labels of a quoted rule", () => {
    // Left quoted, this parsed as one PromQL string literal: no violation,
    // zero labels checked — the guard passed without looking.
    const [expr] = alertExpressions(`    expr: 'sum by (foo) (backlog{bar="x"}) > 0'`)
    const result = checkQueryLabels(expr, catalog)
    expect(result.series).toEqual(["backlog"])
    expect(result.violations).toHaveLength(2)
  })

  it("stops each value at the next key and returns every rule", () => {
    const yaml = [
      "groups:",
      "  - name: g",
      "    rules:",
      "      - alert: A",
      "        expr: backlog > 1",
      "        for: 5m",
      "      - alert: B",
      "        expr: |",
      "          started_total > 2",
      "        labels:",
      "          severity: warning",
    ].join("\n")
    expect(alertExpressions(yaml)).toEqual(["backlog > 1", "started_total > 2"])
  })

  it.each([
    ["an unterminated single quote", "    expr: 'backlog > 0"],
    ["a comment after the closing quote", "    expr: 'backlog > 0' # why"],
    ["an escape outside the JSON subset", '    expr: "backlog \\e > 0"'],
    ["an empty value", "    expr:\n    for: 5m"],
  ])("throws on %s instead of passing it on", (_shape, yaml) => {
    expect(() => alertExpressions(yaml)).toThrow(/alerts\.yml/)
  })
})

describe("dashboardQueries", () => {
  it("collects panel exprs from any depth", () => {
    const dashboard = { panels: [{ targets: [{ expr: "backlog" }, { expr: "started_total" }] }] }
    expect(dashboardQueries(dashboard)).toEqual(["backlog", "started_total"])
  })

  it.each([
    ["label_values(started_total, engine_id)", "count by (engine_id)(started_total)"],
    [
      'label_values(started_total{engine_id=~"$engine",state="COMPLETED"}, engine_id)',
      'count by (engine_id)(started_total{engine_id=~"$engine",state="COMPLETED"})',
    ],
    ["query_result(sum by (engine_id) (backlog))", "sum by (engine_id) (backlog)"],
  ])("rewrites the templating query %s", (query, promql) => {
    // Both the plain string and the newer `{ query: { query } }` object form.
    expect(dashboardQueries({ templating: { list: [{ query }] } })).toEqual([promql])
    expect(dashboardQueries({ templating: { list: [{ query: { query } }] } })).toEqual([promql])
  })

  it("ignores templating queries that name no label", () => {
    expect(dashboardQueries({ list: [{ query: "a,b,c" }, { query: "label_names()" }] })).toEqual([])
  })

  it.each(["label_values(engine_id)", "label_values(started_total, )", "query_result()"])(
    "throws on the unreadable templating query %s instead of skipping it",
    (query) => {
      expect(() => dashboardQueries({ query })).toThrow(/unsupported Grafana templating query/)
    },
  )
})
