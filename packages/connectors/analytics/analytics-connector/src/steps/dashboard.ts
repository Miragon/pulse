import type { PipelineStepDefinition } from "@miragon/mcp-toolkit-core"
import { PERIODS, queries } from "@miragon/pulse-analytics-client"
import { analyticsSettingsSchema, settingsFor } from "../settings.js"
import { NO_NAMES } from "../bpmn-name-lookup.js"
import { namedDashboard } from "../named-views.js"
import {
  ENGINE_KEY_DECLARATION,
  stepEngines,
  stepPeriod,
  stepProcessKey,
  type AnalyticsAppConfig,
} from "./app-config.js"
import { builderText } from "../builder-texts.js"

const MODULE_DEFAULT_PERIOD = analyticsSettingsSchema.shape.defaultPeriod.parse(undefined)

/** Omitted `analytics:period` = the caller's saved default; omitted `analytics:engine` = all configured. */
export const loadDashboardStep: PipelineStepDefinition<AnalyticsAppConfig> = {
  id: "analytics:load-dashboard",
  ...builderText("step.load-dashboard"),
  description:
    "Process metrics: what happened within a time window (instances started/completed, incidents created/resolved, durations of the instances that ended) plus the live state right now (instances running, incidents open), per process definition and per (process, activity). Powers the four dashboard widgets (execution-summary-kpi, execution-performance-kpi, process-definition-breakdown, activity-bottleneck-table).",
  dataType: "analytics:dashboard",
  requires: [],
  optionalKeys: [
    {
      key: "analytics:processDefinitionKey",
      description:
        "Scope the dashboard to a single process definition (e.g. 'miraveloLeasing'). When omitted, all processes are aggregated.",
    },
    {
      key: "analytics:period",
      description: `Time window. When omitted, the caller's saved analytics default (else '${MODULE_DEFAULT_PERIOD}').`,
      enum: [...PERIODS],
    },
    ENGINE_KEY_DECLARATION,
  ],
  produces: ["analytics:dashboardData"],
  execute: async (context, appConfig) => {
    const processDefinitionKey = stepProcessKey(context.keys)
    const engine = stepEngines(context.keys, appConfig.engineScope)
    const period = await stepPeriod(context.keys, appConfig.profileStore)
    // The caller's saved minBucketSize, like the tools'.
    const { minBucketSize } = await settingsFor(appConfig.profileStore)

    const data = await namedDashboard(
      await queries.dashboardData(appConfig.client, {
        processDefinitionKey,
        period,
        engine,
        minBucketSize,
      }),
      appConfig.namesFor ?? NO_NAMES,
    )

    return {
      data,
      keys: { "analytics:dashboardData": data },
      _app: "analytics",
      _step: "load-dashboard",
    }
  },
}
