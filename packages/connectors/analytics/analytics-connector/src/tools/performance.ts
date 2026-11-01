import type { PrometheusClient } from "@miragon/pulse-analytics-client"
import { schemas, queries } from "@miragon/pulse-analytics-client"
import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import { withEngineScope, type AnalyticsEngineScope } from "../engine-ids.js"

export function registerPerformanceTools(
  register: ToolRegistrar<PrometheusClient>,
  engineScope: AnalyticsEngineScope,
) {
  register({
    name: "analytics_analyze_process_performance",
    category: "analytics",
    description:
      "Analyze process performance from metrics over a rolling window: starts, completions, incidents created (incidents, not failed instances) per 100 starts, P50/P95 duration of the instances that ENDED in the window (null when none did), and a per-activity breakdown.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: schemas.analyzePerformanceInput.shape,
    handler: async (ch, args) => queries.analyzePerformance(ch, withEngineScope(engineScope, args)),
  })

  register({
    name: "analytics_compare_execution_periods",
    category: "analytics",
    description:
      "Compare process execution metrics between two explicit time windows (before/after a change, regression analysis), using PromQL historical windows. Windows are clamped to now and the 30-day retention and reported as measured (`partial` when cut short); a reversed or wholly out-of-range window is refused. Compare windows of different length by started_per_day.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: schemas.comparePeriodsInput.shape,
    handler: async (ch, args) => queries.comparePeriods(ch, withEngineScope(engineScope, args)),
  })
}
