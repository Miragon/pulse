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
  ratePct,
  reportingEngineIds,
  reportingEnginesQuery,
} from "./helpers.js"
import { clampWindow, DAY_SECONDS, nowSeconds, windowAt, type CountWindow } from "./windows.js"
import type {
  ActivityBreakdownItem,
  AnalyticsDashboardData,
  DefinitionBreakdownItem,
  ErrorPatternItem,
  FailureDashboardData,
  PreviousPeriodFlows,
  ProcessFailureItem,
} from "../widgets.js"

export const ACTIVITY_BREAKDOWN_LIMIT = 20

// The analytics settings' default `minBucketSize`.
const DEFAULT_MIN_BUCKET_SIZE = 10

const ms = (value: number) => Math.round(value)
const msOrNull = (value: number | null) => (value === null ? null : ms(value))

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
    minBucketSize?: number
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
    actP95,
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
      `histogram_quantile(0.95, sum by (process_definition_key, activity_id, le)(${inWindow(`${M.activityDuration}_bucket${sel}`)}))`,
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

  const totalCount = Math.round(first(started))
  const incidentsCreated = Math.round(first(incCreated))
  const engineReports = reporting.length > 0
  const live = (samples: PromSample[]): number | null => {
    const value = firstOrNull(samples)
    if (value !== null) return Math.round(value)
    return engineReports ? 0 : null
  }

  const activities = buildActivityBreakdown(actCount, actSum, actP95)
  const minBucket = Math.max(1, Math.floor(params.minBucketSize ?? DEFAULT_MIN_BUCKET_SIZE))
  const previous = previousFlows(prevStarted, prevIncidents, before?.partial ?? false)

  return {
    processDefinitionKey: params.processDefinitionKey ?? null,
    period: params.period,
    engines: engineIdsOf(params.engine),
    reportingEngines: reportingEngineIds(reporting),
    asOf,
    totalCount,
    completedCount: Math.round(first(completed)),
    incidentsCreated,
    incidentsResolved: Math.round(first(incResolved)),
    incidentRatePct: ratePct(incidentsCreated, totalCount),
    avgDurationMs: msOrNull(firstOrNull(avg)),
    medianDurationMs: msOrNull(firstOrNull(median)),
    p95DurationMs: msOrNull(firstOrNull(p95)),
    runningNow: live(runningNow),
    openIncidentsNow: live(openIncidentsNow),
    previous: previous && {
      ...previous,
      suppressed: Math.min(totalCount, previous.totalCount) < minBucket,
    },
    activityBreakdown: activities.slice(0, ACTIVITY_BREAKDOWN_LIMIT),
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
  const totalCount = Math.round(first(started))
  const incidentsCreated = Math.round(first(incidents))
  return {
    totalCount,
    incidentsCreated,
    incidentRatePct: ratePct(incidentsCreated, totalCount),
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

function buildActivityBreakdown(
  typedCounts: PromSample[],
  sums: PromSample[],
  p95: PromSample[],
): ActivityBreakdownItem[] {
  const rows = new Map<string, { key: string; id: string; type: string; count: number }>()
  for (const s of typedCounts) {
    const k = activityKey(s)
    const row = rows.get(k) ?? {
      key: s.metric.process_definition_key ?? "",
      id: s.metric.activity_id ?? "",
      type: s.metric.activity_type ?? "",
      count: 0,
    }
    row.count += s.value
    rows.set(k, row)
  }
  const sumBy = byActivityKey(sums)
  const p95By = byActivityKey(p95)
  return [...rows.entries()]
    .map(([k, row]) => {
      const count = Math.round(row.count)
      const sumMs = sumBy.get(k)
      const p95Ms = p95By.get(k)
      return {
        processDefinitionKey: row.key,
        activityId: row.id,
        activityType: row.type,
        executionCount: count,
        avgDurationMs: sumMs !== undefined && count > 0 ? ms(sumMs / count) : null,
        p95DurationMs: p95Ms === undefined ? null : ms(p95Ms),
        totalTimeMs: ms(sumMs ?? 0),
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
        totalInstances: Math.round(startedBy[key] ?? 0),
        completed: Math.round(completedBy[key] ?? 0),
        runningNow: runningReported ? Math.round(runningBy[key] ?? 0) : null,
        incidentsCreated: Math.round(incidentsBy[key] ?? 0),
        avgDurationMs: cnt > 0 ? ms((sumBy[key] ?? 0) / cnt) : null,
      }
    })
    .filter((d) => d.totalInstances > 0 || (d.runningNow ?? 0) > 0)
    .sort(
      (a, b) =>
        b.totalInstances - a.totalInstances ||
        (b.runningNow ?? 0) - (a.runningNow ?? 0) ||
        a.processDefinitionKey.localeCompare(b.processDefinitionKey),
    )
}

// From the live gauges: a counter window over `incident_created` reads zero on backdated or bulk-imported history.
export async function failureDashboardData(
  ch: PrometheusClient,
  params: { engine?: EngineFilterInput },
): Promise<FailureDashboardData> {
  const asOf = asOfNow()
  const sel = selector(engineMatcher(params.engine))

  const [patterns, runningByKey, incidentsByKey, deadJobsByKey] = await Promise.all([
    ch.instant(
      `sum by (process_definition_key, incident_type)(${engineState(M.incidentsOpen, sel)})`,
    ),
    ch.instant(`sum by (process_definition_key)(${engineState(M.processInstancesRunning, sel)})`),
    ch.instant(`sum by (process_definition_key)(${engineState(M.incidentsOpen, sel)})`),
    ch.instant(`sum by (process_definition_key)(${engineState(M.jobsFailed, sel)})`),
  ])

  const allPatterns: ErrorPatternItem[] = patterns
    .map((s) => ({
      incidentType: s.metric.incident_type ?? "",
      processDefinitionKey: s.metric.process_definition_key ?? "",
      incidentCount: Math.round(s.value),
    }))
    .filter((p) => p.incidentCount > 0)
    .sort((a, b) => b.incidentCount - a.incidentCount)
  const errorPatterns = allPatterns.slice(0, 50)

  const runningBy = byLabel(runningByKey, "process_definition_key")
  const incidentBy = byLabel(incidentsByKey, "process_definition_key")
  const deadBy = byLabel(deadJobsByKey, "process_definition_key")

  const processBreakdown: ProcessFailureItem[] = Object.keys(incidentBy)
    .map((key) => {
      const running = Math.round(runningBy[key] ?? 0)
      const openIncidents = Math.round(incidentBy[key] ?? 0)
      return {
        processDefinitionKey: key,
        runningNow: running,
        deadJobs: Math.round(deadBy[key] ?? 0),
        openIncidents,
        incidentRatePct: ratePct(openIncidents, running),
      }
    })
    .filter((p) => p.openIncidents > 0)
    .sort((a, b) => b.openIncidents - a.openIncidents)

  const totalIncidents = allPatterns.reduce((s, p) => s + p.incidentCount, 0)
  return {
    engines: engineIdsOf(params.engine),
    totalIncidents,
    uniqueErrorPatterns: allPatterns.length,
    mostAffectedProcess:
      processBreakdown.length > 0 ? processBreakdown[0].processDefinitionKey : null,
    errorPatterns,
    processBreakdown,
    asOf,
  }
}
