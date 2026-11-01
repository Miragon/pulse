import type { PrometheusClient } from "@miragon/pulse-analytics-client"
import { schemas, queries } from "@miragon/pulse-analytics-client"
import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import { withEngineScope, type AnalyticsEngineScope } from "../engine-ids.js"

export function registerClusterCompareTools(
  register: ToolRegistrar<PrometheusClient>,
  engineScope: AnalyticsEngineScope,
) {
  register({
    name: "analytics_cluster_compare",
    category: "analytics",
    description:
      "Pre/Post deployment correlation from metrics. Given a deployment timestamp and windows before/after, compute instance KPIs per window and the delta, using PromQL historical windows. Windows are clamped to now and the 30-day retention and reported as measured (`windowDays`, `partial`) — right after a deploy the post window holds only the elapsed time; starts compare per day. Results are flagged `suppressed` if either window has fewer than minBucketSize started or completed instances. Typical flow: commit-hash → camunda7_get_deployment → deployment.timestamp → this tool.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: schemas.clusterCompareInput.shape,
    handler: async (ch, args) => queries.clusterCompare(ch, withEngineScope(engineScope, args)),
  })
}
