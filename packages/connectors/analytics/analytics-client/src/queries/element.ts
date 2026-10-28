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
import { asOfNow, byLabel, increaseIn, ratePct, secondsOf, secondsOrNull } from "./helpers.js"

export interface ElementBottleneckRow {
  activity_id: string
  activity_name: string | null
  activity_type: string
  execution_count: number
  avg_duration_sec: number | null
  p95_duration_sec: number | null
  total_time_sec: number
  avg_wait_sec: number | null
  total_wait_sec: number | null
  incident_count: number
  incident_rate_pct: number | null
  bottleneck_score_sec: number
}

export interface ElementBottleneckResult {
  engines: string[] | null
  activities: ElementBottleneckRow[]
  minBucketSize: number
  suppressedActivities: number
}

/**
 * Wait time between activities needs per-instance event ordering, which metrics
 * cannot reconstruct: the wait fields are null and the score is execution time
 * only. `activity_name` is not a metric label.
 */
export async function elementBottleneck(
  ch: PrometheusClient,
  params: {
    processDefinitionKey: string
    period: Period
    minBucketSize: number
    maxResults: number
    engine?: EngineFilterInput
  },
): Promise<ElementBottleneckResult> {
  const range = params.period
  const minBucket = Math.max(1, Math.floor(params.minBucketSize))
  const limit = Math.max(1, Math.floor(params.maxResults))
  const sel = selector(
    `process_definition_key="${escapeLabelValue(params.processDefinitionKey)}"`,
    engineMatcher(params.engine),
  )

  const inWindow = (series: string) => increaseIn(series, { range })

  const [counts, sums, p95, incidents, types] = await Promise.all([
    ch.instant(`sum by (activity_id)(${inWindow(`${M.activityEnded}${sel}`)})`),
    ch.instant(`sum by (activity_id)(${inWindow(`${M.activityDuration}_sum${sel}`)})`),
    ch.instant(
      `histogram_quantile(0.95, sum by (activity_id, le)(${inWindow(`${M.activityDuration}_bucket${sel}`)}))`,
    ),
    ch.instant(`sum by (activity_id)(${inWindow(`${M.incidentCreated}${sel}`)})`),
    ch.instant(`sum by (activity_id, activity_type)(${inWindow(`${M.activityEnded}${sel}`)})`),
  ])

  const sumBy = byLabel(sums, "activity_id")
  const p95By = byLabel(p95, "activity_id")
  const incidentBy = byLabel(incidents, "activity_id")
  const typeBy: Record<string, string> = {}
  for (const t of types) {
    const id = t.metric.activity_id
    if (id !== undefined && typeBy[id] === undefined) typeBy[id] = t.metric.activity_type ?? ""
  }

  const all: ElementBottleneckRow[] = counts.map((c) => {
    const id = c.metric.activity_id ?? ""
    const count = Math.round(c.value)
    const totalMs = sumBy[id] ?? 0
    const incidentCount = Math.round(incidentBy[id] ?? 0)
    return {
      activity_id: id,
      activity_name: null,
      activity_type: typeBy[id] ?? "",
      execution_count: count,
      avg_duration_sec: count > 0 && sumBy[id] !== undefined ? secondsOf(totalMs / count) : null,
      p95_duration_sec: secondsOrNull(p95By[id] ?? null),
      total_time_sec: secondsOf(totalMs),
      avg_wait_sec: null,
      total_wait_sec: null,
      incident_count: incidentCount,
      incident_rate_pct: ratePct(incidentCount, count),
      bottleneck_score_sec: secondsOf(totalMs),
    }
  })

  const kept = all
    .filter((r) => r.execution_count >= minBucket)
    .sort((a, b) => b.bottleneck_score_sec - a.bottleneck_score_sec)
    .slice(0, limit)

  const aboveThreshold = all.filter((r) => r.execution_count >= minBucket).length
  return {
    engines: engineIdsOf(params.engine),
    activities: kept,
    minBucketSize: minBucket,
    suppressedActivities: Math.max(0, all.length - aboveThreshold),
  }
}

export interface ElementHeatResult {
  frequency: Record<string, number>
  durationSec: Record<string, number>
  /** Optional: payloads recorded before it existed lack it. */
  asOf?: string
}

/**
 * Node-level only: metrics carry no per-instance path, so there is no edge heat.
 * Activity metrics have no version label, so this is per `processDefinitionKey`.
 */
export async function elementHeat(
  ch: PrometheusClient,
  params: { processDefinitionKey: string; period: Period; engine?: EngineFilterInput },
): Promise<ElementHeatResult> {
  const asOf = asOfNow()
  const range = params.period
  const sel = selector(
    `process_definition_key="${escapeLabelValue(params.processDefinitionKey)}"`,
    engineMatcher(params.engine),
  )

  const inWindow = (series: string) => increaseIn(series, { range })

  const [counts, sums] = await Promise.all([
    ch.instant(`sum by (activity_id)(${inWindow(`${M.activityEnded}${sel}`)})`),
    ch.instant(`sum by (activity_id)(${inWindow(`${M.activityDuration}_sum${sel}`)})`),
  ])

  const countBy = byLabel(counts, "activity_id")
  const sumBy = byLabel(sums, "activity_id")

  const frequency: Record<string, number> = {}
  const durationSec: Record<string, number> = {}
  for (const [id, count] of Object.entries(countBy)) {
    const c = Math.round(count)
    if (c <= 0) continue
    frequency[id] = c
    durationSec[id] = secondsOf((sumBy[id] ?? 0) / c)
  }
  return { frequency, durationSec, asOf }
}
