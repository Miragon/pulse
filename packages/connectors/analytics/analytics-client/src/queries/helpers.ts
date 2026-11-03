import type { PrometheusClient, PromSample } from "../prometheus.js"
import { GAUGE_LABELS, METRIC_NAMES as M, type GaugeName } from "../metric-names.js"
import { RETENTION_DAYS } from "../prometheus.js"
import { DAY_SECONDS, nowSeconds, rangeSeconds, type CountWindow } from "./windows.js"

export const round1 = (n: number) => Math.round(n * 10) / 10

/** Whole milliseconds, null stays null (the dashboard's rounding). */
export const msOrNull = (value: number | null) => (value === null ? null : Math.round(value))

// Long enough that a scrape gap at a window's start does not pass an old series off as born inside it.
const BORN_LOOKBACK = "1h"
const BORN_LOOKBACK_SECONDS = 3600

/**
 * `increase()` never counts a series' first sample, so a series born inside
 * the window counts its whole value. Where the hour before the window lies
 * past the retention, every series would pass for new; there the born check
 * looks at the window's own first hour instead.
 */
export function increaseIn(series: string, w: CountWindow): string {
  const at = w.at === undefined ? "" : ` @ ${w.at}`
  const plain = `increase(${series}[${w.range}]${at})`
  const offset = bornCheckOffset(w)
  if (offset === null) return plain
  const silent = `present_over_time(${series}[${BORN_LOOKBACK}]${at} offset ${offset})`
  return (
    `((${plain} and ${silent})` +
    ` or (max_over_time(${series}[${w.range}]${at}) unless ${silent}))`
  )
}

function bornCheckOffset(w: CountWindow, now: number = nowSeconds()): string | null {
  const seconds = rangeSeconds(w.range)
  const start = (w.at ?? now) - seconds
  if (start - BORN_LOOKBACK_SECONDS >= now - RETENTION_DAYS * DAY_SECONDS) return w.range
  return seconds > BORN_LOOKBACK_SECONDS ? `${seconds - BORN_LOOKBACK_SECONDS}s` : null
}

// Every node of a clustered engine reports the same rows, so they fold with `max` before anything sums them.
export const engineState = (gauge: GaugeName, sel: string) =>
  `max by (${GAUGE_LABELS[gauge].join(", ")})(${gauge}${sel})`

export function parseIsoSeconds(value: string, field: string): number {
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) {
    throw new Error(
      `${field} "${value}" is not a parseable ISO datetime (expected e.g. 2026-07-01T12:00:00Z)`,
    )
  }
  return Math.round(ms / 1000)
}

/** For counts only: for a duration or a gauge a missing series is "not measured", see {@link firstOrNull}. */
export const first = (s: PromSample[]) => (s.length ? s[0].value : 0)

export const firstOrNull = (s: PromSample[]) => (s.length ? s[0].value : null)

/**
 * The plugin registers a per-key gauge row only for what exists, but
 * `engine_jobs_executable` on every tick: a per-key gauge without a series is
 * a measured 0 while this probe answers. `engineSel` holds the engine matcher only.
 */
export const reportingEnginesQuery = (engineSel: string) => engineState(M.jobsExecutable, engineSel)

export const reportingEngineIds = (samples: PromSample[]): string[] =>
  [...new Set(samples.flatMap((s) => (s.metric.engine_id ? [s.metric.engine_id] : [])))].sort()

export const asOfNow = (): string => new Date().toISOString()

export function byLabel(samples: PromSample[], label: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of samples) {
    const k = s.metric[label]
    if (k !== undefined) out[k] = s.value
  }
  return out
}

// One instance can carry several incidents, so an incident rate may exceed 100.
export function ratePct(part: number, base: number): number | null {
  return base > 0 ? round1((part * 100) / base) : null
}

function pctChange(before: number | null, after: number | null): number | null {
  if (before === null || after === null || before === 0) return null
  return Math.round(((after - before) / before) * 10000) / 100
}

function ppDelta(before: number | null, after: number | null): number | null {
  return before === null || after === null ? null : round1(after - before)
}

export interface KpiScope {
  sel: string
  completedSel: string
  elementIncidentSel?: string
}

// The duration histogram records an instance when it ENDS: still-running long instances are not in it.
export function kpiQueries(scope: KpiScope, w: CountWindow) {
  const { sel, completedSel } = scope
  const duration = M.processInstanceDuration
  return {
    started: `sum(${increaseIn(`${M.processInstanceStarted}${sel}`, w)})`,
    completed: `sum(${increaseIn(`${M.processInstanceEnded}${completedSel}`, w)})`,
    incidents: `sum(${increaseIn(`${M.incidentCreated}${sel}`, w)})`,
    avgDuration: `sum(${increaseIn(`${duration}_sum${sel}`, w)}) / sum(${increaseIn(`${duration}_count${sel}`, w)})`,
    medianDuration: `histogram_quantile(0.5, sum by (le)(${increaseIn(`${duration}_bucket${sel}`, w)}))`,
    p95Duration: `histogram_quantile(0.95, sum by (le)(${increaseIn(`${duration}_bucket${sel}`, w)}))`,
  }
}

export interface CompareKpis {
  startedCount: number
  completedCount: number
  incidentsCreated: number
  incidentRatePct: number | null
  /** Null unless the comparison is scoped to an element (`activityId`). */
  elementIncidentsCreated: number | null
  elementIncidentRatePct: number | null
  avgDurationMs: number | null
  /** Median of the instances that ended; no delta and no widget row. */
  medianDurationMs: number | null
  p95DurationMs: number | null
}

export async function queryCompareKpis(
  ch: PrometheusClient,
  scope: KpiScope,
  w: CountWindow,
): Promise<CompareKpis> {
  const q = kpiQueries(scope, w)
  const element = scope.elementIncidentSel
  const [started, completed, incidents, avg, median, p95, elementIncidents] = await Promise.all([
    ch.instant(q.started),
    ch.instant(q.completed),
    ch.instant(q.incidents),
    ch.instant(q.avgDuration),
    ch.instant(q.medianDuration),
    ch.instant(q.p95Duration),
    element === undefined
      ? Promise.resolve(null)
      : ch.instant(`sum(${increaseIn(`${M.incidentCreated}${element}`, w)})`),
  ])
  const startedCount = Math.round(first(started))
  const incidentsCreated = Math.round(first(incidents))
  const elementCount = elementIncidents === null ? null : Math.round(first(elementIncidents))
  return {
    startedCount,
    completedCount: Math.round(first(completed)),
    incidentsCreated,
    incidentRatePct: ratePct(incidentsCreated, startedCount),
    elementIncidentsCreated: elementCount,
    elementIncidentRatePct: elementCount === null ? null : ratePct(elementCount, startedCount),
    avgDurationMs: msOrNull(firstOrNull(avg)),
    medianDurationMs: msOrNull(firstOrNull(median)),
    p95DurationMs: msOrNull(firstOrNull(p95)),
  }
}

export interface CompareKpiDelta {
  startedPerDayDeltaPct: number | null
  incidentRateDeltaPp: number | null
  elementIncidentRateDeltaPp: number | null
  avgDurationDeltaPct: number | null
  p95DurationDeltaPct: number | null
}

type DeltaInput = Pick<
  CompareKpis,
  "startedCount" | "incidentRatePct" | "elementIncidentRatePct" | "avgDurationMs" | "p95DurationMs"
>

export function compareKpiDelta(
  baseline: DeltaInput,
  other: DeltaInput,
  days: { baseline: number; other: number },
): CompareKpiDelta {
  const perDay = (count: number, d: number) => (d > 0 ? count / d : null)
  return {
    startedPerDayDeltaPct: pctChange(
      perDay(baseline.startedCount, days.baseline),
      perDay(other.startedCount, days.other),
    ),
    incidentRateDeltaPp: ppDelta(baseline.incidentRatePct, other.incidentRatePct),
    elementIncidentRateDeltaPp: ppDelta(
      baseline.elementIncidentRatePct,
      other.elementIncidentRatePct,
    ),
    avgDurationDeltaPct: pctChange(baseline.avgDurationMs, other.avgDurationMs),
    p95DurationDeltaPct: pctChange(baseline.p95DurationMs, other.p95DurationMs),
  }
}

// Starts are the rates' base and completions the durations' sample: either below the floor is noise.
export function belowMinBucket(
  partitions: ReadonlyArray<Pick<CompareKpis, "startedCount" | "completedCount">>,
  minBucketSize: number,
): boolean {
  return partitions.some((p) => p.startedCount < minBucketSize || p.completedCount < minBucketSize)
}
