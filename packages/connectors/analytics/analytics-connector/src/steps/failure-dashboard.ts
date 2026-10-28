import type { PipelineStepDefinition } from "@miragon/mcp-toolkit-core"
import { queries } from "@miragon/pulse-analytics-client"
import { ENGINE_KEY_DECLARATION, stepEngines, type AnalyticsAppConfig } from "./app-config.js"
import { builderText } from "../builder-texts.js"
import { NO_NAMES } from "../bpmn-name-lookup.js"
import { namedFailureDashboard } from "../named-views.js"

/** Live state gauges, so no time-window input. */
export const loadFailureDashboardStep: PipelineStepDefinition<AnalyticsAppConfig> = {
  id: "analytics:load-failure-dashboard",
  ...builderText("step.load-failure-dashboard"),
  description:
    "The incidents open right now, grouped by incident type and process definition, plus each affected process's running instances and dead jobs. Powers the failure widgets (failure-summary-kpi, failure-rate-table, error-patterns-table).",
  dataType: "analytics:failureDashboard",
  requires: [],
  optionalKeys: [ENGINE_KEY_DECLARATION],
  produces: ["analytics:failureDashboardData"],
  execute: async (context, appConfig) => {
    const data = await namedFailureDashboard(
      await queries.failureDashboardData(appConfig.client, {
        engine: stepEngines(context.keys, appConfig.engineScope),
      }),
      appConfig.namesFor ?? NO_NAMES,
    )

    return {
      data,
      keys: { "analytics:failureDashboardData": data },
      _app: "analytics",
      _step: "load-failure-dashboard",
    }
  },
}
