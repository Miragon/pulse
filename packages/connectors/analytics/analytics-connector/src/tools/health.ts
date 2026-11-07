import type { PrometheusClient } from "@miragon/pulse-analytics-client"
import {
  ENGINE_METRICS_STATE_RULE,
  queries,
  withCallerSignal,
} from "@miragon/pulse-analytics-client"
import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import type { AnalyticsEngineScope } from "../engine-ids.js"
import { engineHealthInput } from "../schemas/index.js"

export function registerHealthTools(
  register: ToolRegistrar<PrometheusClient>,
  engineScope: AnalyticsEngineScope,
) {
  register({
    name: "analytics_engine_health",
    category: "analytics",
    description:
      "Live operational health of the CIB seven engine(s), from Prometheus state gauges: running WIP, open incidents by type, failed jobs (retries exhausted), executable/suspended job backlog, open/unassigned user tasks, external-task backlog, deployed definitions, and which alert rules are firing/pending. " +
      "Names the engines judged and the silent ones (`silentEngines`: their counts read 0 because nothing arrives). " +
      `metricsState: ${ENGINE_METRICS_STATE_RULE} ` +
      "Use for fleet-wide or metric-based health.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: engineHealthInput.shape,
    handler: async (ch, args, ctx) => {
      const engines = engineScope.resolve(args.engine)
      // The module's engine-less alerts (a collector outage) only count for a
      // verdict over the whole configured fleet.
      return queries.engineHealth(withCallerSignal(ch, ctx?.mcpReq.signal), {
        engine: engines,
        includeFleetAlerts: engineScope.coversFleet(engines),
      })
    },
  })
}
