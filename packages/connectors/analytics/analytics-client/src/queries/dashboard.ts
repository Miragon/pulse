import {
  engineIdsOf,
  engineMatcher,
  escapeLabelValue,
  selector,
  type EngineFilterInput,
  type Period,
  type PrometheusClient,
  type PromSample,
} from "../prometheus.js"
import { METRIC_NAMES as M } from "../metric-names.js"
import {
  asOfNow,
  byLabel,
  engineState,
  first,
  firstOrNull,
  increaseIn,
  kpiQueries,
  msOrNull,
  ratePct,
  reportingEngineIds,
  reportingEnginesQuery,
} from "./helpers.js"
import { clampWindow, DAY_SECONDS, nowSeconds, windowAt, type CountWindow } from "./windows.js"

/** The activity rows of an unscoped dashboard; one process lists every activity. */
export const ACTIVITY_BREAKDOWN_LIMIT = 20

// The comparisons' default `minBucketSize`: below it the previous rate gets no verdict.
const MIN_BUCKET_SIZE = 10

export interface ActivityBreakdownItem {
  processDefinitionKey: string
  activityId: string
  /** "" for an activity with incidents but no ended execution: only `activity_ended` carries it. */
  activityType: string
  executionCount: number
  avgDurationMs: number | null
  medianDurationMs: number | null
  p95DurationMs: number | null
  totalTimeMs: number
  /** Incidents created at this (process, activity) in the period. */
  incidentsCreated: number
}

export interface DefinitionBreakdownItem {
  processDefinitionKey: string
  startedCount: number
  completedCount: number
  runningNow: number | null
  incidentsCreated: number
  avgDurationMs: number | null
}

export interface PreviousPeriodFlows {
  startedCount: number
  incidentsCreated: number
  incidentRatePct: number | null
  partial: boolean
  suppressed: boolean
}

export interface AnalyticsDashboardData {
  processDefinitionKey: string | null
  period: Period
  engines: string[] | null
  reportingEngines: string[]
  asOf: string
  startedCount: number
  completedCount: number
  incidentsCreated: number
  incidentsResolved: number
  incidentRatePct: number | null
  avgDurationMs: number | null
  medianDurationMs: number | null
  p95DurationMs: number | null
  runningNow: number | null
  openIncidentsNow: number | null
  previous: PreviousPeriodFlows | null
  /** Every activity of one process; unscoped, the top {@link ACTIVITY_BREAKDOWN_LIMIT} by total time. */
  activityBreakdown: ActivityBreakdownItem[]
  activityCount: number
  definitionBreakdown: DefinitionBreakdownItem[]
}

/**
 * Live state comes from the state gauges, never from a counter difference
 * within the window: that misses every instance started before the window.
 * A missing per-key gauge row is 0 while an engine in scope reports, null only while none does.
 * `previous` is the reference an incident rate is judged against; a rate on
 * its own says nothing about whether it is high.
 */
export async function dashboardData(
  ch: PrometheusClient,
  params: {
    processDefinitionKey?: string
    period: Period
    engine?: EngineFilterInput
  },
): Promise<AnalyticsDashboardData> {
  const asOf = asOfNow()
  const range = params.period
  const engine = engineMatcher(params.engine)
  const keyMatcher = params.processDefinitionKey
    ? `process_definition_key="${escapeLabelValue(params.processDefinitionKey)}"`
    : undefined
  const sel = selector(keyMatcher, engine)
  const completedSel = selector(keyMatcher, `state="COMPLETED"`, engine)
  const w: CountWindow = { range }
  const q = kpiQueries({ sel, completedSel }, w)
  const before = previousWindow(params.period)
  const prev = before ? kpiQueries({ sel, completedSel }, windowAt(before)) : null
  const inWindow = (series: string) => increaseIn(series, w)

  const [
    started,
    completed,
    incCreated,
    incResolved,
    avg,
    median,
    p95,
    runningNow,
    openIncidentsNow,
    actCount,
    actSum,
    actMedian,
    actP95,
    actIncidents,
    defStarted,
    defCompleted,
    defIncidents,
    defDurSum,
    defDurCount,
    defRunning,
    reporting,
    prevStarted,
    prevIncidents,
  ] = await Promise.all([
    ch.instant(q.started),
    ch.instant(q.completed),
    ch.instant(q.incidents),
    ch.instant(`sum(${inWindow(`${M.incidentResolved}${sel}`)})`),
    ch.instant(q.avgDuration),
    ch.instant(q.medianDuration),
    ch.instant(q.p95Duration),
    ch.instant(`sum(${engineState(M.processInstancesRunning, sel)})`),
    ch.instant(`sum(${engineState(M.incidentsOpen, sel)})`),
    ch.instant(
      `sum by (process_definition_key, activity_id, activity_type)(${inWindow(`${M.activityEnded}${sel}`)})`,
    ),
    ch.instant(
      `sum by (process_definition_key, activity_id)(${inWindow(`${M.activityDuration}_sum${sel}`)})`,
    ),
    ch.instant(
      `histogram_quantile(0.5, sum by (process_definition_key, activity_id, le)(${inWindow(`${M.activityDuration}_bucket${sel}`)}))`,
    ),
    ch.instant(
      `histogram_quantile(0.95, sum by (process_definition_key, activity_id, le)(${inWindow(`${M.activityDuration}_bucket${sel}`)}))`,
    ),
    ch.instant(
      `sum by (process_definition_key, activity_id)(${inWindow(`${M.incidentCreated}${sel}`)})`,
    ),
    ch.instant(`sum by (process_definition_key)(${inWindow(`${M.processInstanceStarted}${sel}`)})`),
    ch.instant(
      `sum by (process_definition_key)(${inWindow(`${M.processInstanceEnded}${completedSel}`)})`,
    ),
    ch.instant(`sum by (process_definition_key)(${inWindow(`${M.incidentCreated}${sel}`)})`),
    ch.instant(
      `sum by (process_definition_key)(${inWindow(`${M.processInstanceDuration}_sum${sel}`)})`,
    ),
    ch.instant(
      `sum by (process_definition_key)(${inWindow(`${M.processInstanceDuration}_count${sel}`)})`,
    ),
    ch.instant(`sum by (process_definition_key)(${engineState(M.processInstancesRunning, sel)})`),
    ch.instant(reportingEnginesQuery(selector(engine))),
    prev ? ch.instant(prev.started) : null,
    prev ? ch.instant(prev.incidents) : null,
  ])

  const startedCount = Math.round(first(started))
  const incidentsCreated = Math.round(first(incCreated))
  const engineReports = reporting.length > 0
  const live = (samples: PromSample[]): number | null => {
    const value = firstOrNull(samples)
    if (value !== null) return Math.round(value)
    return engineReports ? 0 : null
  }

  const activities = buildActivityBreakdown(actCount, actSum, actMedian, actP95, actIncidents)
  const previous = previousFlows(prevStarted, prevIncidents, before?.partial ?? false)

  return {
    processDefinitionKey: params.processDefinitionKey ?? null,
    period: params.period,
    engines: engineIdsOf(params.engine),
    reportingEngines: reportingEngineIds(reporting),
    asOf,
    startedCount,
    completedCount: Math.round(first(completed)),
    incidentsCreated,
    incidentsResolved: Math.round(first(incResolved)),
    incidentRatePct: ratePct(incidentsCreated, startedCount),
    avgDurationMs: msOrNull(firstOrNull(avg)),
    medianDurationMs: msOrNull(firstOrNull(median)),
    p95DurationMs: msOrNull(firstOrNull(p95)),
    runningNow: live(runningNow),
    openIncidentsNow: live(openIncidentsNow),
    previous: previous && {
      ...previous,
      suppressed: Math.min(startedCount, previous.startedCount) < MIN_BUCKET_SIZE,
    },
    activityBreakdown: params.processDefinitionKey
      ? activities
      : activities.slice(0, ACTIVITY_BREAKDOWN_LIMIT),
    activityCount: activities.length,
    definitionBreakdown: buildDefinitionBreakdown(
      {
        started: defStarted,
        completed: defCompleted,
        incidents: defIncidents,
        durSum: defDurSum,
        durCount: defDurCount,
        running: defRunning,
      },
      engineReports || defRunning.length > 0,
    ),
  }
}

const periodSeconds = (period: Period) => Number.parseInt(period, 10) * DAY_SECONDS

function previousWindow(period: Period) {
  const now = nowSeconds()
  const length = periodSeconds(period)
  try {
    return clampWindow("previous period", now - 2 * length, now - length, now)
  } catch {
    return null
  }
}

function previousFlows(
  started: PromSample[] | null,
  incidents: PromSample[] | null,
  partial: boolean,
): Omit<PreviousPeriodFlows, "suppressed"> | null {
  if (!started || !incidents) return null
  const startedCount = Math.round(first(started))
  const incidentsCreated = Math.round(first(incidents))
  return {
    startedCount,
    incidentsCreated,
    incidentRatePct: ratePct(incidentsCreated, startedCount),
    partial,
  }
}

// Activity ids repeat across models, so the process is part of the key.
const activityKey = (s: PromSample) =>
  `${s.metric.process_definition_key ?? ""}\u0000${s.metric.activity_id ?? ""}`

function byActivityKey(samples: PromSample[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of samples) out.set(activityKey(s), s.value)
  return out
}

/**
 * A row per activity that ended in the period, and per activity with incidents but no ended
 * execution (all of them failed): the incident series carries no `activity_type`, so its type
 * stays "". An incident sample without an activity is no row.
 */
function buildActivityBreakdown(
  typedCounts: PromSample[],
  sums: PromSample[],
  median: PromSample[],
  p95: PromSample[],
  incidents: PromSample[],
): ActivityBreakdownItem[] {
  const rows = new Map<string, { key: string; id: string; type: string; count: number }>()
  const rowOf = (s: PromSample) => {
    const k = activityKey(s)
    const row = rows.get(k) ?? {
      key: s.metric.process_definition_key ?? "",
      id: s.metric.activity_id ?? "",
      type: s.metric.activity_type ?? "",
      count: 0,
    }
    rows.set(k, row)
    return row
  }
  for (const s of typedCounts) rowOf(s).count += s.value
  for (const s of incidents) {
    if (s.metric.activity_id && Math.round(s.value) > 0) rowOf(s)
  }
  const sumBy = byActivityKey(sums)
  const medianBy = byActivityKey(median)
  const p95By = byActivityKey(p95)
  const incidentsBy = byActivityKey(incidents)
  return [...rows.entries()]
    .map(([k, row]) => {
      const count = Math.round(row.count)
      const sumMs = sumBy.get(k)
      const medianMs = medianBy.get(k)
      const p95Ms = p95By.get(k)
      return {
        processDefinitionKey: row.key,
        activityId: row.id,
        activityType: row.type,
        executionCount: count,
        avgDurationMs: sumMs !== undefined && count > 0 ? Math.round(sumMs / count) : null,
        medianDurationMs: medianMs === undefined ? null : Math.round(medianMs),
        p95DurationMs: p95Ms === undefined ? null : Math.round(p95Ms),
        totalTimeMs: Math.round(sumMs ?? 0),
        incidentsCreated: Math.round(incidentsBy.get(k) ?? 0),
      }
    })
    .sort((a, b) => b.totalTimeMs - a.totalTimeMs)
}

function buildDefinitionBreakdown(
  s: {
    started: PromSample[]
    completed: PromSample[]
    incidents: PromSample[]
    durSum: PromSample[]
    durCount: PromSample[]
    running: PromSample[]
  },
  runningReported: boolean,
): DefinitionBreakdownItem[] {
  const startedBy = byLabel(s.started, "process_definition_key")
  const completedBy = byLabel(s.completed, "process_definition_key")
  const incidentsBy = byLabel(s.incidents, "process_definition_key")
  const sumBy = byLabel(s.durSum, "process_definition_key")
  const countBy = byLabel(s.durCount, "process_definition_key")
  const runningBy = byLabel(s.running, "process_definition_key")
  // Running keys count too: a long-running process must not vanish from the breakdown.
  const keys = new Set([...Object.keys(startedBy), ...Object.keys(runningBy)])
  return [...keys]
    .map((key) => {
      const cnt = countBy[key] ?? 0
      return {
        processDefinitionKey: key,
        startedCount: Math.round(startedBy[key] ?? 0),
        completedCount: Math.round(completedBy[key] ?? 0),
        runningNow: runningReported ? Math.round(runningBy[key] ?? 0) : null,
        incidentsCreated: Math.round(incidentsBy[key] ?? 0),
        avgDurationMs: cnt > 0 ? Math.round((sumBy[key] ?? 0) / cnt) : null,
      }
    })
    .filter((d) => d.startedCount > 0 || (d.runningNow ?? 0) > 0)
    .sort(
      (a, b) =>
        b.startedCount - a.startedCount ||
        (b.runningNow ?? 0) - (a.runningNow ?? 0) ||
        a.processDefinitionKey.localeCompare(b.processDefinitionKey),
    )
}
