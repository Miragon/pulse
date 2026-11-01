import type { PrometheusClient } from "@miragon/pulse-analytics-client"
import { schemas, queries } from "@miragon/pulse-analytics-client"
import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import type { ProfileSource } from "../server-locale.js"
import { optionalMinBucketSize, settingsFor } from "../settings.js"
import { withEngineScope, type AnalyticsEngineScope } from "../engine-ids.js"

export function registerVersionCompareTools(
  register: ToolRegistrar<PrometheusClient>,
  engineScope: AnalyticsEngineScope,
  profileStore?: ProfileSource,
) {
  register({
    name: "analytics_version_compare",
    category: "analytics",
    description:
      "Compare KPIs between two deployed process definition versions of the same processDefinitionKey over a shared rolling window, from metrics. The version is an exact label on the process-instance and incident series, so instance counts, completed counts, incidents, the incident rate and durations (avg, p95) per version plus their deltas are precise. Process-wide: the element_incident_* fields stay null. Flagged `suppressed` when either version has fewer than minBucketSize started or completed instances. Pair with camunda7_list_process_definitions to discover versions.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...schemas.versionCompareInput.shape, minBucketSize: optionalMinBucketSize },
    handler: async (ch, args, ctx) =>
      queries.versionCompare(ch, {
        ...withEngineScope(engineScope, args),
        minBucketSize: args.minBucketSize ?? (await settingsFor(profileStore, ctx)).minBucketSize,
      }),
  })
}
