import {
  engineIdsOf,
  engineMatcher,
  escapeLabelValue,
  selector,
  type EngineFilterInput,
  type PrometheusClient,
} from "../prometheus.js"
import {
  asOfNow,
  belowMinBucket,
  compareKpiDelta,
  queryCompareKpis,
  type CompareKpiDelta,
  type CompareKpis,
} from "./helpers.js"

export interface VersionCompareKpi extends CompareKpis {
  version: number
}

export interface VersionCompareResult {
  engines: string[] | null
  processDefinitionKey: string
  versionA: number
  versionB: number
  windowDays: number
  minBucketSize: number
  suppressed: boolean
  kpis: [VersionCompareKpi, VersionCompareKpi]
  delta: CompareKpiDelta
  asOf: string
}

// The version is a label on the instance and incident series, not on the activity series, so the
// incident figures are exact per version and there is no element scope.
export async function versionCompare(
  ch: PrometheusClient,
  params: {
    processDefinitionKey: string
    versionA: number
    versionB: number
    windowDays: number
    minBucketSize: number
    engine?: EngineFilterInput
  },
): Promise<VersionCompareResult> {
  const minBucket = Math.max(1, Math.floor(params.minBucketSize))
  const windowDays = Math.max(1, Math.floor(params.windowDays))
  const versionA = Math.max(1, Math.floor(params.versionA))
  const versionB = Math.max(1, Math.floor(params.versionB))
  const range = `${windowDays}d`
  const asOf = asOfNow()

  const [a, b] = await Promise.all([
    versionKpi(ch, params, versionA, range),
    versionKpi(ch, params, versionB, range),
  ])

  return {
    asOf,
    engines: engineIdsOf(params.engine),
    processDefinitionKey: params.processDefinitionKey,
    versionA,
    versionB,
    windowDays,
    minBucketSize: minBucket,
    suppressed: belowMinBucket([a, b], minBucket),
    kpis: [a, b],
    delta: compareKpiDelta(a, b, { baseline: windowDays, other: windowDays }),
  }
}

async function versionKpi(
  ch: PrometheusClient,
  params: { processDefinitionKey: string; engine?: EngineFilterInput },
  version: number,
  range: string,
): Promise<VersionCompareKpi> {
  const engine = engineMatcher(params.engine)
  const key = `process_definition_key="${escapeLabelValue(params.processDefinitionKey)}"`
  const ver = `process_definition_version="${version}"`
  const kpis = await queryCompareKpis(
    ch,
    {
      sel: selector(key, ver, engine),
      completedSel: selector(key, ver, `state="COMPLETED"`, engine),
    },
    { range },
  )
  return { version, ...kpis }
}
