import { modelContextText } from "@miragon/pulse-widget-shell/widgets"
import { ANALYTICS_ONLY_SURFACE, engineIdsOf, isAggregate } from "./hand-off.js"
import type { AnalyticsBpmnHeatmapData } from "./bpmn-heatmap.js"

/**
 * Built by `modelContextText` (#338). Only for a view whose tool result does not carry what it
 * shows: every other analytics view returns its figures to the model as JSON. The scope comes
 * from the DATA, never a widget's props (#336); an unmeasured figure is left out, never 0. Names
 * analytics tools only: a pure description cannot query the camunda7 surface.
 */

/** Said whenever a figure adds up several engines (the deliberate fleet aggregate). */
const AGGREGATED = " The figures add up every engine listed (aggregated)."

function maxEntry(values: Record<string, number>): [string, number] | null {
  let best: [string, number] | null = null
  for (const [key, value] of Object.entries(values)) {
    if (!best || value > best[1]) best = [key, value]
  }
  return best
}

/**
 * The BPMN heatmap, over the engines its heat adds up (the `engines` echo, #336): the data it
 * shows, never its props.
 */
export function describeBpmnHeatmap(data: AnalyticsBpmnHeatmapData): string {
  const hottest = maxEntry(data.frequency)
  const slowest = maxEntry(data.durationSec)
  return modelContextText({
    summary:
      "The operator is viewing the BPMN heatmap of one process (the frequency ↔ duration toggle " +
      "is client-side)." +
      (isAggregate(data.engines) ? AGGREGATED : ""),
    ids: {
      engine: engineIdsOf(data.engines),
      processDefinitionKey: data.processDefinitionKey,
      period: data.period,
    },
    facts: {
      elementsWithHeat: Object.keys(data.frequency).length,
      hottestActivityId: hottest?.[0],
      hottestExecutions: hottest?.[1],
      slowestActivityId: slowest?.[0],
      slowestAvgSec: slowest ? Math.round(slowest[1] * 10) / 10 : undefined,
    },
    tools: ["analytics_show_dashboard"],
    surface: ANALYTICS_ONLY_SURFACE,
  })
}
