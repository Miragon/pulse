import type { PrometheusClient } from "@miragon/pulse-analytics-client"
import { schemas, queries } from "@miragon/pulse-analytics-client"
import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import { withEngineScope, type AnalyticsEngineScope } from "../engine-ids.js"

export function registerFailureTools(
  register: ToolRegistrar<PrometheusClient>,
  engineScope: AnalyticsEngineScope,
) {
  register({
    name: "analytics_find_failed_instances",
    category: "analytics",
    description:
      "List currently-open incident patterns from process metrics, grouped by incident type and process definition (point-in-time — what is failing right now; no message, activity or timestamps). Use for counts across engines; for the actual failed instances (ids, messages) use camunda7_list_incidents, for past ones camunda7_query_historic_incidents.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: schemas.findFailedInstancesInput.shape,
    handler: async (ch, args) =>
      queries.findFailedInstances(ch, withEngineScope(engineScope, args)),
  })
}
