import type { PrometheusClient } from "@miragon/pulse-analytics-client"
import { schemas, queries } from "@miragon/pulse-analytics-client"
import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import type { AnalyticsEngineScope } from "../engine-ids.js"

export function registerEngineCompareTools(
  register: ToolRegistrar<PrometheusClient>,
  engineScope: AnalyticsEngineScope,
) {
  register({
    name: "analytics_engine_compare",
    category: "analytics",
    description:
      "Compare ONE process definition as it runs on two configured CIB Seven engines (e.g. prod-a vs prod-b) over a shared rolling window, from metrics. processDefinitionKey is required: engines host different process mixes, so comparing their whole workloads would measure the mix rather than the engines — holding the process fixed is what makes the delta attributable. Returns per engine starts, completions, incidents per 100 starts (with activityId also at that element) and avg/p95 duration of the instances that ENDED, plus the deltas. Flagged `suppressed` when either engine has fewer than minBucketSize started or completed instances. For the unscoped cross-engine picture (what runs where, load, job backlog, which keys are deployed on several engines) use analytics_engine_landscape first; its `sharedProcessKeys` are the valid inputs here.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: schemas.engineCompareInput.shape,
    handler: async (ch, args) =>
      queries.engineCompare(ch, {
        ...args,
        engineA: engineScope.require(args.engineA, "engineA"),
        engineB: engineScope.require(args.engineB, "engineB"),
      }),
  })
}
