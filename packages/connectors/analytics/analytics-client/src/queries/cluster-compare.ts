import {
  engineIdsOf,
  engineMatcher,
  escapeLabelValue,
  selector,
  type EngineFilterInput,
  type PrometheusClient,
} from "../prometheus.js"
import {
  belowMinBucket,
  compareKpiDelta,
  parseIsoSeconds,
  queryCompareKpis,
  type CompareKpiDelta,
  type CompareKpis,
} from "./helpers.js"
import {
  DAY_SECONDS,
  clampWindow,
  daysOf,
  isoOf,
  nowSeconds,
  windowAt,
  type ClampedWindow,
} from "./windows.js"

export interface ClusterCompareKpi extends CompareKpis {
  period: "before" | "after"
  window_from: string
  window_to: string
  window_days: number
}

export type ClusterCompareDelta = CompareKpiDelta

export interface ClusterCompareResult {
  engines: string[] | null
  processDefinitionKey: string | null
  activityId: string | null
  deploymentTimestamp: string
  requestedWindowDays: { before: number; after: number }
  windowDays: { before: number; after: number }
  partial: boolean
  minBucketSize: number
  suppressed: boolean
  kpis: ClusterCompareKpi[]
  delta: ClusterCompareDelta
  /** Optional: payloads recorded before it existed lack it. */
  asOf?: string
}

/**
 * Right after a deployment the post-deploy window holds only the elapsed hours,
 * so starts are compared per day: windows of different length compare fairly.
 */
export async function clusterCompare(
  ch: PrometheusClient,
  params: {
    processDefinitionKey?: string
    activityId?: string
    deploymentTimestamp: string
    windowBeforeDays: number
    windowAfterDays: number
    minBucketSize: number
    engine?: EngineFilterInput
  },
): Promise<ClusterCompareResult> {
  const minBucket = Math.max(1, Math.floor(params.minBucketSize))
  const before = Math.max(1, Math.floor(params.windowBeforeDays))
  const after = Math.max(1, Math.floor(params.windowAfterDays))
  const deployTs = parseIsoSeconds(params.deploymentTimestamp, "deploymentTimestamp")
  const now = nowSeconds()
  if (deployTs >= now) {
    throw new Error(
      "deploymentTimestamp lies in the future (or is now) — there is no post-deployment window to compare yet",
    )
  }

  const beforeWin = clampWindow(
    "the pre-deployment window",
    deployTs - before * DAY_SECONDS,
    deployTs,
    now,
  )
  const afterWin = clampWindow(
    "the post-deployment window",
    deployTs,
    deployTs + after * DAY_SECONDS,
    now,
  )

  const [b, a] = await Promise.all([
    windowKpi(ch, params, "before", beforeWin),
    windowKpi(ch, params, "after", afterWin),
  ])

  return {
    engines: engineIdsOf(params.engine),
    processDefinitionKey: params.processDefinitionKey ?? null,
    activityId: params.activityId ?? null,
    deploymentTimestamp: params.deploymentTimestamp,
    requestedWindowDays: { before, after },
    windowDays: { before: b.window_days, after: a.window_days },
    partial: beforeWin.partial || afterWin.partial,
    minBucketSize: minBucket,
    suppressed: belowMinBucket([b, a], minBucket),
    kpis: [b, a],
    asOf: new Date(now * 1000).toISOString(),
    // Exact lengths, not the rounded `window_days`: a 2 h window is 0.083 d.
    delta: compareKpiDelta(b, a, {
      baseline: beforeWin.seconds / DAY_SECONDS,
      other: afterWin.seconds / DAY_SECONDS,
    }),
  }
}

async function windowKpi(
  ch: PrometheusClient,
  params: {
    processDefinitionKey?: string
    activityId?: string
    engine?: EngineFilterInput
  },
  period: "before" | "after",
  win: ClampedWindow,
): Promise<ClusterCompareKpi> {
  const engine = engineMatcher(params.engine)
  const keyMatcher = params.processDefinitionKey
    ? `process_definition_key="${escapeLabelValue(params.processDefinitionKey)}"`
    : undefined
  const kpis = await queryCompareKpis(
    ch,
    {
      sel: selector(keyMatcher, engine),
      completedSel: selector(keyMatcher, `state="COMPLETED"`, engine),
      elementIncidentSel: params.activityId
        ? selector(keyMatcher, `activity_id="${escapeLabelValue(params.activityId)}"`, engine)
        : undefined,
    },
    windowAt(win),
  )
  return {
    period,
    ...kpis,
    window_from: isoOf(win.from),
    window_to: isoOf(win.to),
    window_days: daysOf(win.seconds),
  }
}
