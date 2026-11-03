import { afterEach, describe, expect, it } from "vitest"
import type { CompareKpiDelta } from "@miragon/pulse-analytics-client"
import { setFormatLocale } from "@miragon/pulse-ui"
import { translator, type T } from "../messages/use-t.js"
import {
  DURATION_MIN_CHANGE_PCT,
  RATE_MIN_CHANGE,
  buildComparisonMetrics,
  deltaFacts,
  deltaVerdict,
  formatDelta,
  type DeltaRule,
} from "./comparison-shared.js"

afterEach(() => setFormatLocale(undefined))

const english = () => setFormatLocale({ language: "en", locale: "en-US" })
const german = () => setFormatLocale({ language: "de", locale: "de-DE" })
const en: T = (key, params) => translator("en", key, params)
const de: T = (key, params) => translator("de", key, params)

/** The formatters keep a number and its unit together with a non-breaking space. */
const plain = (s: string) => s.replace(/\u00a0/g, " ")

type Kpis = Parameters<typeof buildComparisonMetrics>[1]

const kpis = (over: Partial<Kpis> = {}): Kpis => ({
  startedCount: 1240,
  incidentRatePct: 5,
  elementIncidentsCreated: null,
  elementIncidentRatePct: null,
  avgDurationMs: 60_000,
  p95DurationMs: 187_000,
  ...over,
})

const delta: CompareKpiDelta = {
  startedPerDayDeltaPct: 10,
  incidentRateDeltaPp: -2,
  elementIncidentRateDeltaPp: null,
  avgDurationDeltaPct: 5,
  p95DurationDeltaPct: null,
}

const row = (t: T, metrics: ReturnType<typeof buildComparisonMetrics>, labelKey: string) =>
  metrics.find((m) => m.label === t(labelKey))

const VOLUME: DeltaRule = { kind: "volume" }
const DURATION: DeltaRule = { kind: "quality", worseIfUp: true, minChange: DURATION_MIN_CHANGE_PCT }
const RATE: DeltaRule = { kind: "quality", worseIfUp: true, minChange: RATE_MIN_CHANGE }

describe("buildComparisonMetrics", () => {
  it("formats the values in the view's locale and keeps the raw deltas with their rule", () => {
    english()
    const metrics = buildComparisonMetrics(en, kpis(), kpis({ incidentRatePct: 3 }), delta)

    expect(row(en, metrics, "aComparison.metricIncidentRate")).toEqual({
      label: "Incidents per 100 starts",
      before: "5.0",
      after: "3.0",
      delta: { value: -2, unit: "rate", rule: RATE },
    })
    // The count per window, the delta per day: fair across unequal windows,
    // and a volume, so it carries no verdict rule.
    expect(row(en, metrics, "aComparison.metricStarted")).toMatchObject({
      label: "Starts (change per day)",
      before: "1,240",
      delta: { value: 10, unit: "pct", rule: VOLUME },
    })
    expect(row(en, metrics, "aComparison.metricAvgDuration")).toMatchObject({
      before: "1m 0s",
      delta: { value: 5, unit: "pct", rule: DURATION },
    })
    expect(row(en, metrics, "aComparison.metricP95Duration")).toMatchObject({
      before: "3m 7s",
      delta: { value: null },
    })
  })

  it("speaks German: grouped digits, decimal comma, German units and labels", () => {
    german()
    const metrics = buildComparisonMetrics(de, kpis(), kpis({ incidentRatePct: 3.25 }), delta)
    expect(row(de, metrics, "aComparison.metricStarted")).toMatchObject({
      label: "Starts (Änderung je Tag)",
      before: "1.240",
    })
    expect(row(de, metrics, "aComparison.metricIncidentRate")).toMatchObject({
      label: "Incidents je 100 Starts",
      before: "5,0",
      after: "3,3",
    })
    expect(plain(row(de, metrics, "aComparison.metricP95Duration")!.before)).toBe("3 Min. 7 s")
  })

  it("renders unmeasured rates as 'not measured' with no delta, never as 0 (#327)", () => {
    english()
    const unmeasured = kpis({ incidentRatePct: null })
    const metrics = buildComparisonMetrics(en, unmeasured, unmeasured, {
      ...delta,
      incidentRateDeltaPp: null,
    })

    expect(row(en, metrics, "aComparison.metricIncidentRate")).toMatchObject({
      before: "not measured",
      after: "not measured",
      delta: { value: null },
    })
    expect(JSON.stringify(metrics)).not.toContain('"0.0"')
  })

  it("renders 'nothing ended' as an unmeasured duration, never 0 ms (N78)", () => {
    german()
    const noneEnded = kpis({ avgDurationMs: null, p95DurationMs: null })
    const metrics = buildComparisonMetrics(de, kpis(), noneEnded, {
      ...delta,
      avgDurationDeltaPct: null,
    })

    for (const labelKey of ["aComparison.metricAvgDuration", "aComparison.metricP95Duration"]) {
      expect(row(de, metrics, labelKey)).toMatchObject({
        after: "nicht gemessen",
        delta: { value: null },
      })
    }
    expect(JSON.stringify(metrics)).not.toContain("0 ms")
  })

  it("shows the element incident rate only when the comparison was scoped to an element", () => {
    english()
    expect(
      row(
        en,
        buildComparisonMetrics(en, kpis(), kpis(), delta),
        "aComparison.metricElementIncidentRate",
      ),
    ).toBeUndefined()

    const scoped = kpis({ elementIncidentsCreated: 2, elementIncidentRatePct: 5 })
    expect(
      row(
        en,
        buildComparisonMetrics(
          en,
          scoped,
          kpis({ elementIncidentsCreated: 0, elementIncidentRatePct: 0 }),
          { ...delta, elementIncidentRateDeltaPp: -5 },
        ),
        "aComparison.metricElementIncidentRate",
      ),
    ).toMatchObject({ before: "5.0", after: "0.0", delta: { value: -5, unit: "rate", rule: RATE } })
  })
})

describe("deltaVerdict (U6): volume neutral, thresholds per metric, suppressed not reliable", () => {
  it("never judges a volume: fewer starts on a test engine are no regression", () => {
    for (const value of [-84.7, 0, 427.4]) {
      expect(deltaVerdict(value, VOLUME, false)).toBeUndefined()
      expect(deltaVerdict(value, VOLUME, true)).toBeUndefined()
    }
  })

  it("judges a duration only from 5 % on, in either direction", () => {
    expect(deltaVerdict(4.9, DURATION, false)).toBeUndefined()
    expect(deltaVerdict(-4.9, DURATION, false)).toBeUndefined()
    expect(deltaVerdict(5, DURATION, false)).toBe("worse")
    expect(deltaVerdict(-5, DURATION, false)).toBe("better")
  })

  it("judges an incident rate only from 1 incident per 100 starts on", () => {
    expect(deltaVerdict(0.2, RATE, false)).toBeUndefined()
    expect(deltaVerdict(-0.94, RATE, false)).toBeUndefined()
    expect(deltaVerdict(1, RATE, false)).toBe("worse")
    expect(deltaVerdict(-6.5, RATE, false)).toBe("better")
  })

  it("judges the delta as the cell shows it, so one number never gets two readings", () => {
    german()
    // 4.96 shows as "+5 %": judged like 5. 4.94 shows as "+4,9 %": neutral.
    expect(plain(formatDelta(4.96, "pct"))).toBe("+5 %")
    expect(deltaVerdict(4.96, DURATION, false)).toBe("worse")
    expect(deltaVerdict(-4.96, DURATION, false)).toBe("better")
    expect(plain(formatDelta(4.94, "pct"))).toBe("+4,9 %")
    expect(deltaVerdict(4.94, DURATION, false)).toBeUndefined()
    // Half away from zero, like Intl: -0.95 shows as "-1" and is judged.
    expect(formatDelta(-0.95, "rate")).toBe("-1")
    expect(deltaVerdict(-0.95, RATE, false)).toBe("better")
    expect(formatDelta(0.96, "rate")).toBe("+1")
    expect(deltaVerdict(0.96, RATE, false)).toBe("worse")
    // A change that rounds to zero shows no sign and no verdict.
    expect(formatDelta(-0.04, "rate")).toBe("0")
    expect(deltaVerdict(-0.04, RATE, false)).toBeUndefined()
  })

  it("follows the metric's direction: a rule where up is good flips the verdict", () => {
    const upIsGood: DeltaRule = { kind: "quality", worseIfUp: false, minChange: 1 }
    expect(deltaVerdict(3, upIsGood, false)).toBe("better")
    expect(deltaVerdict(-3, upIsGood, false)).toBe("worse")
  })

  it("calls every quality delta of a suppressed comparison not reliable, below threshold too", () => {
    expect(deltaVerdict(-100, DURATION, true)).toBe("notReliable")
    expect(deltaVerdict(0.1, RATE, true)).toBe("notReliable")
  })

  it("has nothing to judge for a missing delta (a zero baseline)", () => {
    expect(deltaVerdict(null, DURATION, false)).toBeUndefined()
    expect(deltaVerdict(null, RATE, true)).toBeUndefined()
  })
})

describe("formatDelta", () => {
  it("signs relative changes as percent and rate changes in the rate's own unit", () => {
    english()
    expect(formatDelta(12.5, "pct")).toBe("+12.5%")
    expect(formatDelta(-84.66, "pct")).toBe("-84.7%")
    expect(formatDelta(0.24, "rate")).toBe("+0.2")
    expect(formatDelta(0, "rate")).toBe("0")
    expect(formatDelta(null, "pct")).toBe("—")
    german()
    expect(plain(formatDelta(12.5, "pct"))).toBe("+12,5 %")
    expect(formatDelta(-2, "rate")).toBe("-2")
  })
})

describe("deltaFacts", () => {
  it("names starts per day and leaves a never-measured delta null, never a 0", () => {
    expect(deltaFacts(delta, false)).toEqual({
      startedPerDayDeltaPct: 10,
      incidentRateDeltaPp: -2,
      elementIncidentRateDeltaPp: null,
      avgDurationDeltaPct: 5,
      p95DurationDeltaPct: null,
      suppressed: false,
    })
  })
})
