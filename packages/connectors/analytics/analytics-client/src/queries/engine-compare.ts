import { escapeLabelValue, selector, type PrometheusClient } from "../prometheus.js"
import {
  asOfNow,
  belowMinBucket,
  compareKpiDelta,
  queryCompareKpis,
  type CompareKpiDelta,
  type CompareKpis,
} from "./helpers.js"

export interface EngineCompareKpi extends CompareKpis {
  engineId: string
  bucket: "engineA" | "engineB"
}

export type EngineCompareDelta = CompareKpiDelta

export interface EngineCompareResult {
  engineA: string
  engineB: string
  processDefinitionKey: string
  windowDays: number
  activityId: string | null
  minBucketSize: number
  suppressed: boolean
  kpis: EngineCompareKpi[]
  delta: EngineCompareDelta
  /** Optional: payloads recorded before it existed lack it. */
  asOf?: string
}

// `processDefinitionKey` is required: two engines' whole workloads compare their process mixes, not the engines.
export async function engineCompare(
  ch: PrometheusClient,
  params: {
    processDefinitionKey: string
    engineA: string
    engineB: string
    windowDays: number
    activityId?: string
    minBucketSize: number
  },
): Promise<EngineCompareResult> {
  const minBucket = Math.max(1, Math.floor(params.minBucketSize))
  const windowDays = Math.max(1, Math.floor(params.windowDays))
  const range = `${windowDays}d`
  const asOf = asOfNow()

  const [a, b] = await Promise.all([
    engineKpi(ch, params, "engineA", params.engineA, range),
    engineKpi(ch, params, "engineB", params.engineB, range),
  ])

  return {
    asOf,
    engineA: params.engineA,
    engineB: params.engineB,
    processDefinitionKey: params.processDefinitionKey,
    windowDays,
    activityId: params.activityId ?? null,
    minBucketSize: minBucket,
    suppressed: belowMinBucket([a, b], minBucket),
    kpis: [a, b],
    delta: compareKpiDelta(a, b, { baseline: windowDays, other: windowDays }),
  }
}

async function engineKpi(
  ch: PrometheusClient,
  params: { processDefinitionKey: string; activityId?: string },
  bucket: "engineA" | "engineB",
  engineId: string,
  range: string,
): Promise<EngineCompareKpi> {
  const engine = `engine_id="${escapeLabelValue(engineId)}"`
  const keyMatcher = `process_definition_key="${escapeLabelValue(params.processDefinitionKey)}"`
  const kpis = await queryCompareKpis(
    ch,
    {
      sel: selector(keyMatcher, engine),
      completedSel: selector(keyMatcher, `state="COMPLETED"`, engine),
      elementIncidentSel: params.activityId
        ? selector(keyMatcher, `activity_id="${escapeLabelValue(params.activityId)}"`, engine)
        : undefined,
    },
    { range },
  )
  return { engineId, bucket, ...kpis }
}
