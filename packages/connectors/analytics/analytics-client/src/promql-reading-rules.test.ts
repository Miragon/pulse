import { describe, expect, it } from "vitest"
import {
  readingRuleViolations,
  type ReadingRuleMetric,
} from "./promql-reading-rules.test-support.js"
import { engineState, increaseIn } from "./queries/helpers.js"

const METRICS: ReadingRuleMetric[] = [
  { promName: "engine_inc_total", type: "counter", labels: ["engine_id"] },
  { promName: "engine_dur_milliseconds", type: "histogram", labels: ["engine_id"] },
  { promName: "engine_open", type: "gauge", labels: ["process_definition_key", "engine_id"] },
]

const violations = (
  promql: string,
  plainIncreaseAllowed?: (range: string, at?: number) => boolean,
) => readingRuleViolations(promql, METRICS, { plainIncreaseAllowed })

describe("readingRuleViolations — counters and histograms", () => {
  it("accepts the born-series count, rolling and pinned, with a selector", () => {
    const born = (series: string, range: string, at?: number) =>
      `((increase(${series}[${range}]${at === undefined ? "" : ` @ ${at}`}) and present_over_time(${series}[1h]${at === undefined ? "" : ` @ ${at}`} offset ${range})) or (max_over_time(${series}[${range}]${at === undefined ? "" : ` @ ${at}`}) unless present_over_time(${series}[1h]${at === undefined ? "" : ` @ ${at}`} offset ${range})))`
    expect(violations(`sum(${born('engine_inc_total{engine_id="a"}', "7d")})`)).toEqual([])
    expect(
      violations(
        `histogram_quantile(0.95, sum by (le)(${born("engine_dur_milliseconds_bucket", "86400s", 1700000000)}))`,
      ),
    ).toEqual([])
    expect(violations(`sum(${born("engine_inc_total", "$__range")})`)).toEqual([])
  })

  it("rejects a plain increase(), rate() or a raw counter", () => {
    expect(violations("sum(increase(engine_inc_total[7d]))")).toHaveLength(1)
    expect(violations("sum(rate(engine_inc_total[5m])) * 60")).toHaveLength(1)
    expect(violations("sum(engine_dur_milliseconds_sum)")).toHaveLength(1)
  })

  it("rejects a born-series count whose parts disagree", () => {
    // The two silence checks must look at the same hour …
    const offsets =
      "((increase(engine_inc_total[7d]) and present_over_time(engine_inc_total[1h] offset 7d)) or (max_over_time(engine_inc_total[7d]) unless present_over_time(engine_inc_total[1h] offset 1d)))"
    expect(violations(offsets).length).toBeGreaterThan(0)
    // … and both reads span the same window.
    const ranges =
      "((increase(engine_inc_total[7d]) and present_over_time(engine_inc_total[1h] offset 7d)) or (max_over_time(engine_inc_total[1d]) unless present_over_time(engine_inc_total[1h] offset 7d)))"
    expect(violations(ranges).length).toBeGreaterThan(0)
  })

  it("accepts the window's own first hour as the silence check at the retention edge", () => {
    const edge =
      "((increase(engine_inc_total[30d]) and present_over_time(engine_inc_total[1h] offset 2588400s)) or (max_over_time(engine_inc_total[30d]) unless present_over_time(engine_inc_total[1h] offset 2588400s)))"
    expect(violations(`sum(${edge})`)).toEqual([])
  })

  it("lets a plain increase() through only where the caller allows its window", () => {
    const allowed = (range: string) => range === "30d"
    expect(violations("sum(increase(engine_inc_total[30d]))", allowed)).toEqual([])
    expect(violations("sum(increase(engine_inc_total[7d]))", allowed)).toHaveLength(1)
  })

  it("accepts exactly what increaseIn emits", () => {
    expect(
      violations(`sum(${increaseIn('engine_inc_total{engine_id="a"}', { range: "7d" })})`),
    ).toEqual([])
    expect(
      violations(
        `sum(${increaseIn("engine_dur_milliseconds_sum", { range: "3600s", at: Math.floor(Date.now() / 1000) })})`,
      ),
    ).toEqual([])
  })
})

describe("readingRuleViolations — gauges", () => {
  it("accepts a gauge folded over exactly its contract labels, in any order", () => {
    expect(
      violations('sum(max by (engine_id, process_definition_key)(engine_open{engine_id="a"}))'),
    ).toEqual([])
    expect(violations("max by (process_definition_key, engine_id) (engine_open)")).toEqual([])
  })

  it("rejects a summed, partly folded or over-folded gauge", () => {
    expect(violations("sum(engine_open)")).toHaveLength(1)
    expect(violations("sum by (engine_id)(max by (engine_id)(engine_open))")).toHaveLength(1)
    expect(
      violations("max by (engine_id, process_definition_key, instance)(engine_open)"),
    ).toHaveLength(1)
    expect(violations("max(engine_open)")).toHaveLength(1)
  })
})

describe("engineState", () => {
  it("folds a gauge over its contract labels", () => {
    expect(engineState("engine_incidents_open", '{engine_id="a"}')).toBe(
      'max by (process_definition_key, incident_type, engine_id)(engine_incidents_open{engine_id="a"})',
    )
  })
})
