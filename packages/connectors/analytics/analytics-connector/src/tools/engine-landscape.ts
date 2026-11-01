import type { PrometheusClient } from "@miragon/pulse-analytics-client"
import { schemas, queries } from "@miragon/pulse-analytics-client"
import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import { withEngineScope, type AnalyticsEngineScope } from "../engine-ids.js"

export function registerEngineLandscapeTools(
  register: ToolRegistrar<PrometheusClient>,
  engineScope: AnalyticsEngineScope,
) {
  register({
    name: "analytics_engine_landscape",
    category: "analytics",
    description:
      "Cross-engine overview of the process landscape: which process definitions run on which engine (the inventory matrix), the absolute load per engine (running instances, open incidents, failed jobs), and the engine-owned job backlog (executable/suspended/future-due jobs, open external tasks). Reports counts, not rates, on purpose — engines host different process mixes, so a per-engine failure rate or average duration measures the mix rather than the engine. The backlog gauges carry no process label and therefore DO compare across engines. Returns `sharedProcessKeys`: the definitions deployed on more than one engine, the only sound inputs for analytics_engine_compare. Covers the server's configured engines (omitted engine = all of them); an engine reporting no metrics at all comes back with `reporting: false`.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: schemas.engineLandscapeInput.shape,
    handler: async (ch, args) => queries.engineLandscape(ch, withEngineScope(engineScope, args)),
  })
}
