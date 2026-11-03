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
  round1,
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

export interface PeriodCompareKpi extends CompareKpis {
  /** The period as measured: clamped to now and the retention. */
  from: string
  to: string
  days: number
  partial: boolean
  /** From the exact length, never the rounded `days`. */
  startedPerDay: number
}

export interface PeriodCompareResult {
  engines: string[] | null
  processDefinitionKey: string | null
  activityId: string | null
  /** The periods as requested, so a hand-off re-runs the comparison as asked. */
  periodAFrom: string
  periodATo: string
  periodBFrom: string
  periodBTo: string
  minBucketSize: number
  suppressed: boolean
  partial: boolean
  kpis: [PeriodCompareKpi, PeriodCompareKpi]
  delta: CompareKpiDelta
  asOf: string
}

interface PeriodCompareParams {
  processDefinitionKey?: string
  activityId?: string
  periodAFrom: string
  periodATo: string
  periodBFrom: string
  periodBTo: string
  minBucketSize: number
  engine?: EngineFilterInput
}

/**
 * A is the baseline, B the candidate. A period reaching past now holds only the elapsed part
 * (right after a deployment: hours), so starts compare per day and periods of different length
 * compare fairly.
 */
export async function periodCompare(
  ch: PrometheusClient,
  params: PeriodCompareParams,
): Promise<PeriodCompareResult> {
  const minBucket = Math.max(1, Math.floor(params.minBucketSize))
  const now = nowSeconds()
  const winA = explicitWindow("periodA", params.periodAFrom, params.periodATo, now)
  const winB = explicitWindow("periodB", params.periodBFrom, params.periodBTo, now)

  const [a, b] = await Promise.all([periodKpi(ch, params, winA), periodKpi(ch, params, winB)])

  return {
    engines: engineIdsOf(params.engine),
    processDefinitionKey: params.processDefinitionKey ?? null,
    activityId: params.activityId ?? null,
    periodAFrom: params.periodAFrom,
    periodATo: params.periodATo,
    periodBFrom: params.periodBFrom,
    periodBTo: params.periodBTo,
    minBucketSize: minBucket,
    suppressed: belowMinBucket([a, b], minBucket),
    partial: winA.partial || winB.partial,
    kpis: [a, b],
    // Exact lengths, not the rounded `days`: a 2 h period is 0.083 d.
    delta: compareKpiDelta(a, b, {
      baseline: winA.seconds / DAY_SECONDS,
      other: winB.seconds / DAY_SECONDS,
    }),
    asOf: isoOf(now),
  }
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
  params: PeriodCompareParams,
  win: ClampedWindow,
): Promise<PeriodCompareKpi> {
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
    ...kpis,
    from: isoOf(win.from),
    to: isoOf(win.to),
    days: daysOf(win.seconds),
    partial: win.partial,
    startedPerDay: round1((kpis.startedCount * DAY_SECONDS) / win.seconds),
  }
}
