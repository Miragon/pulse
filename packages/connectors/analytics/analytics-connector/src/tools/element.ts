import type { PrometheusClient } from "@miragon/pulse-analytics-client"
import { schemas, queries } from "@miragon/pulse-analytics-client"
import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import type { ProfileSource } from "../server-locale.js"
import { optionalMinBucketSize, optionalPeriod, settingsFor } from "../settings.js"
import { withEngineScope, type AnalyticsEngineScope } from "../engine-ids.js"

export function registerElementTools(
  register: ToolRegistrar<PrometheusClient>,
  engineScope: AnalyticsEngineScope,
  profileStore?: ProfileSource,
) {
  register({
    name: "analytics_element_bottleneck",
    category: "analytics",
    description:
      "Rank activities by execution-time contribution and incident rate over a rolling window, from process metrics. Activities with fewer than `minBucketSize` executions are suppressed. Note: queue/wait time is not available from metrics.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      ...schemas.elementBottleneckInput.shape,
      period: optionalPeriod,
      minBucketSize: optionalMinBucketSize,
    },
    handler: async (ch, args, ctx) => {
      const settings = await settingsFor(profileStore, ctx)
      return queries.elementBottleneck(ch, {
        ...withEngineScope(engineScope, args),
        period: args.period ?? settings.defaultPeriod,
        minBucketSize: args.minBucketSize ?? settings.minBucketSize,
      })
    },
  })
}
