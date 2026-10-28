import type { PrometheusClient, PromSample } from "../prometheus.js"
import { GAUGE_LABELS, METRIC_NAMES as M, type GaugeName } from "../metric-names.js"
import { RETENTION_DAYS } from "../prometheus.js"
import { DAY_SECONDS, nowSeconds, rangeSeconds, type CountWindow } from "./windows.js"

export const round1 = (n: number) => Math.round(n * 10) / 10

export const secondsOf = (ms: number) => round1(ms / 1000)

export const secondsOrNull = (ms: number | null) => (ms === null ? null : secondsOf(ms))

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
 * `camunda_jobs_executable` on every tick: a per-key gauge without a series is
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

export function pctChange(before: number | null, after: number | null): number | null {
  if (before === null || after === null || before === 0) return null
  return Math.round(((after - before) / before) * 10000) / 100
}

export function ppDelta(before: number | null, after: number | null): number | null {
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
  instance_count: number
  completed_count: number
  incident_count: number
  incident_rate_pct: number | null
  element_incident_count: number | null
  element_incident_rate_pct: number | null
  avg_duration_sec: number | null
  p95_duration_sec: number | null
}

export async function queryCompareKpis(
  ch: PrometheusClient,
  scope: KpiScope,
  w: CountWindow,
): Promise<CompareKpis> {
  const q = kpiQueries(scope, w)
  const element = scope.elementIncidentSel
  const [total, completed, incidents, avg, p95, elementIncidents] = await Promise.all([
    ch.instant(q.started),
    ch.instant(q.completed),
    ch.instant(q.incidents),
    ch.instant(q.avgDuration),
    ch.instant(q.p95Duration),
    element === undefined
      ? Promise.resolve(null)
      : ch.instant(`sum(${increaseIn(`${M.incidentCreated}${element}`, w)})`),
  ])
  const instances = Math.round(first(total))
  const incidentCount = Math.round(first(incidents))
  const elementCount = elementIncidents === null ? null : Math.round(first(elementIncidents))
  return {
    instance_count: instances,
    completed_count: Math.round(first(completed)),
    incident_count: incidentCount,
    incident_rate_pct: ratePct(incidentCount, instances),
    element_incident_count: elementCount,
    element_incident_rate_pct: elementCount === null ? null : ratePct(elementCount, instances),
    avg_duration_sec: secondsOrNull(firstOrNull(avg)),
    p95_duration_sec: secondsOrNull(firstOrNull(p95)),
  }
}

export interface CompareKpiDelta {
  started_per_day_delta_pct: number | null
  incident_rate_delta_pp: number | null
  element_incident_rate_delta_pp: number | null
  avg_duration_delta_pct: number | null
  p95_duration_delta_pct: number | null
}

type DeltaInput = Pick<
  CompareKpis,
  | "instance_count"
  | "incident_rate_pct"
  | "element_incident_rate_pct"
  | "avg_duration_sec"
  | "p95_duration_sec"
>

export function compareKpiDelta(
  baseline: DeltaInput,
  other: DeltaInput,
  days: { baseline: number; other: number },
): CompareKpiDelta {
  const perDay = (count: number, d: number) => (d > 0 ? count / d : null)
  return {
    started_per_day_delta_pct: pctChange(
      perDay(baseline.instance_count, days.baseline),
      perDay(other.instance_count, days.other),
    ),
    incident_rate_delta_pp: ppDelta(baseline.incident_rate_pct, other.incident_rate_pct),
    element_incident_rate_delta_pp: ppDelta(
      baseline.element_incident_rate_pct,
      other.element_incident_rate_pct,
    ),
    avg_duration_delta_pct: pctChange(baseline.avg_duration_sec, other.avg_duration_sec),
    p95_duration_delta_pct: pctChange(baseline.p95_duration_sec, other.p95_duration_sec),
  }
}

// Starts are the rates' base and completions the durations' sample: either below the floor is noise.
export function belowMinBucket(
  partitions: ReadonlyArray<Pick<CompareKpis, "instance_count" | "completed_count">>,
  minBucketSize: number,
): boolean {
  return partitions.some(
    (p) => p.instance_count < minBucketSize || p.completed_count < minBucketSize,
  )
}
