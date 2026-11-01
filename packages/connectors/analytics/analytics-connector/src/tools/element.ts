import type { PrometheusClient } from "@miragon/pulse-analytics-client"
import { schemas, queries } from "@miragon/pulse-analytics-client"
import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import { withEngineScope, type AnalyticsEngineScope } from "../engine-ids.js"

export function registerElementTools(
  register: ToolRegistrar<PrometheusClient>,
  engineScope: AnalyticsEngineScope,
) {
  register({
    name: "analytics_element_bottleneck",
    category: "analytics",
    description:
      "Rank activities by execution-time contribution and incident rate over a rolling window, from process metrics. Activities with fewer than `minBucketSize` executions are suppressed. Note: queue/wait time is not available from metrics.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: schemas.elementBottleneckInput.shape,
    handler: async (ch, args) => queries.elementBottleneck(ch, withEngineScope(engineScope, args)),
  })
}
