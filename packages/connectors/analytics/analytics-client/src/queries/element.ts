import {
  engineMatcher,
  escapeLabelValue,
  selector,
  type EngineFilterInput,
  type Period,
  type PrometheusClient,
} from "../prometheus.js"
import { METRIC_NAMES as M } from "../metric-names.js"
import { asOfNow, byLabel, increaseIn, secondsOf } from "./helpers.js"

export interface ElementHeatResult {
  frequency: Record<string, number>
  durationSec: Record<string, number>
  asOf: string
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
