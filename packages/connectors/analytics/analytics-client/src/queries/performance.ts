import {
  engineIdsOf,
  engineMatcher,
  escapeLabelValue,
  selector,
  type EngineFilterInput,
  type Period,
  type PrometheusClient,
} from "../prometheus.js"
import { METRIC_NAMES as M } from "../metric-names.js"
import {
  byLabel,
  first,
  firstOrNull,
  increaseIn,
  kpiQueries,
  parseIsoSeconds,
  ratePct,
  round1,
  secondsOf,
  secondsOrNull,
} from "./helpers.js"
import {
  clampWindow,
  DAY_SECONDS,
  daysOf,
  isoOf,
  nowSeconds,
  windowAt,
  type ClampedWindow,
  type CountWindow,
} from "./windows.js"

export interface PerformanceKPI {
  process_definition_key: string
  total_instances: number
  completed: number
  incident_count: number
  incident_rate_pct: number | null
  avg_duration_sec: number | null
  median_duration_sec: number | null
  p95_duration_sec: number | null
}

export interface ActivityBreakdownRow {
  activity_id: string
  /** Not a metric label — resolve names from the BPMN. Always null. */
  activity_name: null
  activity_type: string
  execution_count: number
  avg_duration_sec: number | null
  median_duration_sec: number | null
  p95_duration_sec: number | null
  total_time_sec: number
}

export interface PeriodComparisonKpi {
  period: string
  window_from: string
  window_to: string
  window_days: number
  partial: boolean
  total_instances: number
  started_per_day: number
  completed: number
  incident_count: number
  incident_rate_pct: number | null
  avg_duration_sec: number | null
  median_sec: number | null
  p95_sec: number | null
}

export interface PeriodActivityComparisonRow {
  activity_id: string
  activity_name: null
  period: string
  executions: number
  avg_sec: number | null
  p95_sec: number | null
}

export interface PerformanceResult {
  engines: string[] | null
  kpi: PerformanceKPI | null
  activityBreakdown: ActivityBreakdownRow[]
}

export interface PeriodComparisonResult {
  engines: string[] | null
  kpiComparison: PeriodComparisonKpi[]
  activityComparison?: PeriodActivityComparisonRow[]
}

function pdkSelector(
  key: string,
  engineId: EngineFilterInput,
  ...extra: Array<string | undefined>
) {
  return selector(
    `process_definition_key="${escapeLabelValue(key)}"`,
    engineMatcher(engineId),
    ...extra,
  )
}

// `incident_count` counts incidents created: metrics carry no per-instance terminal-failure state.
export async function analyzePerformance(
  ch: PrometheusClient,
  params: {
    processDefinitionKey: string
    period: string
    includeActivityBreakdown: boolean
    engine?: EngineFilterInput
  },
): Promise<PerformanceResult> {
  const range = (params.period as Period) ?? "7d"
  const q = kpiQueries(
    {
      sel: pdkSelector(params.processDefinitionKey, params.engine),
      completedSel: pdkSelector(params.processDefinitionKey, params.engine, 'state="COMPLETED"'),
    },
    { range },
  )

  const [total, completed, incidents, avg, median, p95] = await Promise.all([
    ch.instant(q.started),
    ch.instant(q.completed),
    ch.instant(q.incidents),
    ch.instant(q.avgDuration),
    ch.instant(q.medianDuration),
    ch.instant(q.p95Duration),
  ])

  const totalInstances = Math.round(first(total))
  const completedCount = Math.round(first(completed))
  const incidentCount = Math.round(first(incidents))
  const avgMs = firstOrNull(avg)
  const observed = totalInstances > 0 || completedCount > 0 || incidentCount > 0 || avgMs !== null
  const kpi: PerformanceKPI | null = observed
    ? {
        process_definition_key: params.processDefinitionKey,
        total_instances: totalInstances,
        completed: completedCount,
        incident_count: incidentCount,
        incident_rate_pct: ratePct(incidentCount, totalInstances),
        avg_duration_sec: secondsOrNull(avgMs),
        median_duration_sec: secondsOrNull(firstOrNull(median)),
        p95_duration_sec: secondsOrNull(firstOrNull(p95)),
      }
    : null

  let activityBreakdown: ActivityBreakdownRow[] = []
  if (params.includeActivityBreakdown) {
    activityBreakdown = await activityBreakdownRows(
      ch,
      params.processDefinitionKey,
      { range },
      params.engine,
    )
  }

  return { engines: engineIdsOf(params.engine), kpi, activityBreakdown }
}

async function activityBreakdownRows(
  ch: PrometheusClient,
  key: string,
  w: CountWindow,
  engineId: EngineFilterInput,
): Promise<ActivityBreakdownRow[]> {
  const sel = pdkSelector(key, engineId)
  const inWindow = (series: string) => increaseIn(series, w)
  const [counts, sums, median, p95] = await Promise.all([
    ch.instant(`sum by (activity_id, activity_type)(${inWindow(`${M.activityEnded}${sel}`)})`),
    ch.instant(`sum by (activity_id)(${inWindow(`${M.activityDuration}_sum${sel}`)})`),
    ch.instant(
      `histogram_quantile(0.5, sum by (activity_id, le)(${inWindow(`${M.activityDuration}_bucket${sel}`)}))`,
    ),
    ch.instant(
      `histogram_quantile(0.95, sum by (activity_id, le)(${inWindow(`${M.activityDuration}_bucket${sel}`)}))`,
    ),
  ])
  const sumBy = byLabel(sums, "activity_id")
  const medianBy = byLabel(median, "activity_id")
  const p95By = byLabel(p95, "activity_id")
  const rows: ActivityBreakdownRow[] = counts.map((c) => {
    const id = c.metric.activity_id ?? ""
    const count = Math.round(c.value)
    const sumMs = sumBy[id]
    return {
      activity_id: id,
      activity_name: null,
      activity_type: c.metric.activity_type ?? "",
      execution_count: count,
      avg_duration_sec: sumMs !== undefined && count > 0 ? secondsOf(sumMs / count) : null,
      median_duration_sec: secondsOrNull(medianBy[id] ?? null),
      p95_duration_sec: secondsOrNull(p95By[id] ?? null),
      total_time_sec: secondsOf(sumMs ?? 0),
    }
  })
  return rows.sort((a, b) => b.total_time_sec - a.total_time_sec).slice(0, 20)
}

export async function comparePeriods(
  ch: PrometheusClient,
  params: {
    processDefinitionKey: string
    periodAFrom: string
    periodATo: string
    periodBFrom: string
    periodBTo: string
    includeActivityBreakdown: boolean
    engine?: EngineFilterInput
  },
): Promise<PeriodComparisonResult> {
  const now = nowSeconds()
  const a = explicitWindow("periodA", params.periodAFrom, params.periodATo, now)
  const b = explicitWindow("periodB", params.periodBFrom, params.periodBTo, now)
  const [kpiA, kpiB] = await Promise.all([
    periodKpi(ch, params.processDefinitionKey, "Period A", a, params.engine),
    periodKpi(ch, params.processDefinitionKey, "Period B", b, params.engine),
  ])
  const result: PeriodComparisonResult = {
    engines: engineIdsOf(params.engine),
    kpiComparison: [kpiA, kpiB],
  }

  if (params.includeActivityBreakdown) {
    const [actA, actB] = await Promise.all([
      periodActivities(ch, params.processDefinitionKey, "Period A", a, params.engine),
      periodActivities(ch, params.processDefinitionKey, "Period B", b, params.engine),
    ])
    result.activityComparison = [...actA, ...actB].sort(
      (x, y) => x.activity_id.localeCompare(y.activity_id) || x.period.localeCompare(y.period),
    )
  }
  return result
}

function explicitWindow(
  name: "periodA" | "periodB",
  from: string,
  to: string,
  now: number,
): ClampedWindow {
  return clampWindow(
    name,
    parseIsoSeconds(from, `${name}From`),
    parseIsoSeconds(to, `${name}To`),
    now,
  )
}

async function periodKpi(
  ch: PrometheusClient,
  key: string,
  label: string,
  w: ClampedWindow,
  engineId: EngineFilterInput,
): Promise<PeriodComparisonKpi> {
  const q = kpiQueries(
    {
      sel: pdkSelector(key, engineId),
      completedSel: pdkSelector(key, engineId, 'state="COMPLETED"'),
    },
    windowAt(w),
  )
  const [total, completed, incidents, avg, median, p95] = await Promise.all([
    ch.instant(q.started),
    ch.instant(q.completed),
    ch.instant(q.incidents),
    ch.instant(q.avgDuration),
    ch.instant(q.medianDuration),
    ch.instant(q.p95Duration),
  ])
  const totalInstances = Math.round(first(total))
  const incidentCount = Math.round(first(incidents))
  return {
    period: label,
    window_from: isoOf(w.from),
    window_to: isoOf(w.to),
    window_days: daysOf(w.seconds),
    partial: w.partial,
    total_instances: totalInstances,
    // From the exact length: the rounded window_days of a 5-minute window is 0.00 d.
    started_per_day: round1((totalInstances * DAY_SECONDS) / w.seconds),
    completed: Math.round(first(completed)),
    incident_count: incidentCount,
    incident_rate_pct: ratePct(incidentCount, totalInstances),
    avg_duration_sec: secondsOrNull(firstOrNull(avg)),
    median_sec: secondsOrNull(firstOrNull(median)),
    p95_sec: secondsOrNull(firstOrNull(p95)),
  }
}

async function periodActivities(
  ch: PrometheusClient,
  key: string,
  label: string,
  w: ClampedWindow,
  engineId: EngineFilterInput,
): Promise<PeriodActivityComparisonRow[]> {
  const sel = pdkSelector(key, engineId)
  const inWindow = (series: string) => increaseIn(series, windowAt(w))
  const [counts, sums, p95] = await Promise.all([
    ch.instant(`sum by (activity_id)(${inWindow(`${M.activityEnded}${sel}`)})`),
    ch.instant(`sum by (activity_id)(${inWindow(`${M.activityDuration}_sum${sel}`)})`),
    ch.instant(
      `histogram_quantile(0.95, sum by (activity_id, le)(${inWindow(`${M.activityDuration}_bucket${sel}`)}))`,
    ),
  ])
  const sumBy = byLabel(sums, "activity_id")
  const p95By = byLabel(p95, "activity_id")
  return counts.map((c) => {
    const id = c.metric.activity_id ?? ""
    const executions = Math.round(c.value)
    const sumMs = sumBy[id]
    return {
      activity_id: id,
      activity_name: null,
      period: label,
      executions,
      avg_sec: sumMs !== undefined && executions > 0 ? secondsOf(sumMs / executions) : null,
      p95_sec: secondsOrNull(p95By[id] ?? null),
    }
  })
}
