import { z } from "zod"
import type { AppDefinition } from "@miragon/mcp-toolkit-core"
import { PERIODS } from "@miragon/pulse-analytics-client"
import { loadDashboardStep, loadFailureDashboardStep } from "./steps/index.js"
import { builderAppTitle, builderText, fieldText } from "./builder-texts.js"

/** Omitted = all configured engines. */
const engineScopeProp = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .describe(
    "Configured engine id(s) the self-fetch is scoped to. When omitted, every configured engine is aggregated.",
  )

const dashboardPropsSchema = z.toJSONSchema(
  z.object({
    processDefinitionKey: z
      .string()
      .optional()
      .describe(
        "Scope the dashboard to a single process definition (e.g. 'miraveloLeasing'). When omitted, all processes are aggregated.",
      )
      .meta(fieldText("dashboard.processDefinitionKey")),
    period: z
      .enum(PERIODS)
      .optional()
      .describe("Time window for the self-fetch when no upstream pipeline step populates data.")
      .meta(fieldText("dashboard.period")),
    engine: engineScopeProp.meta(fieldText("dashboard.engine")),
  }),
)

const failurePropsSchema = z.toJSONSchema(
  z.object({ engine: engineScopeProp.meta(fieldText("failure.engine")) }),
)

const engineLandscapePropsSchema = z.toJSONSchema(
  z.object({
    engine: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe(
        "Engine ids to include in the landscape; when omitted, every configured engine (one reporting no metrics shows as not reporting).",
      )
      .meta(fieldText("engineLandscape.engine")),
  }),
)

export const definition: AppDefinition = {
  name: "analytics",
  // The view builder's names for people (en + de); `description` is the model's text.
  title: builderAppTitle(),
  steps: [loadDashboardStep, loadFailureDashboardStep],
  widgets: [
    {
      id: "analytics:execution-summary-kpi",
      ...builderText("widget.execution-summary-kpi"),
      description:
        "Top-line KPIs: instances started and completed and incidents created within the period, plus instances running and incidents open right now.",
      requires: [],
      consumes: ["analytics:dashboard"],
      size: "full",
      propsSchema: dashboardPropsSchema,
    },
    {
      id: "analytics:execution-performance-kpi",
      ...builderText("widget.execution-performance-kpi"),
      description:
        "Duration KPIs of the instances that ended within the period (avg, median, p95) and incidents per 100 started instances.",
      requires: [],
      consumes: ["analytics:dashboard"],
      size: "full",
      propsSchema: dashboardPropsSchema,
    },
    {
      id: "analytics:process-definition-breakdown",
      ...builderText("widget.process-definition-breakdown"),
      description:
        "Per-process-definition breakdown: instances started and completed and incidents created within the period, instances running now, average duration.",
      requires: [],
      consumes: ["analytics:dashboard"],
      size: "full",
      propsSchema: dashboardPropsSchema,
    },
    {
      id: "analytics:activity-bottleneck-table",
      ...builderText("widget.activity-bottleneck-table"),
      description:
        "Top (process, activity) pairs by total time spent within the period — surfaces bottlenecks across the process landscape.",
      requires: [],
      consumes: ["analytics:dashboard"],
      size: "full",
      propsSchema: dashboardPropsSchema,
    },
    {
      id: "analytics:failure-summary-kpi",
      ...builderText("widget.failure-summary-kpi"),
      description:
        "Failure summary KPIs right now (open incidents, incident groups by type × process, most affected process).",
      requires: [],
      consumes: ["analytics:failureDashboard"],
      size: "full",
      propsSchema: failurePropsSchema,
    },
    {
      id: "analytics:error-patterns-table",
      ...builderText("widget.error-patterns-table"),
      description:
        "The incidents open right now, grouped by incident type and process definition, with counts.",
      requires: [],
      consumes: ["analytics:failureDashboard"],
      size: "full",
      propsSchema: failurePropsSchema,
    },
    {
      id: "analytics:failure-rate-table",
      ...builderText("widget.failure-rate-table"),
      description:
        "Per-process live failure state: running instances, dead jobs, open incidents and open incidents per 100 running instances.",
      requires: [],
      consumes: ["analytics:failureDashboard"],
      size: "full",
      propsSchema: failurePropsSchema,
    },
    {
      id: "analytics:cluster-compare",
      ...builderText("widget.cluster-compare"),
      description:
        "Side-by-side before/after comparison of instance KPIs around a deployment timestamp.",
      requires: [],
      consumes: ["analytics:clusterCompare"],
      size: "full",
    },
    {
      id: "analytics:version-compare",
      ...builderText("widget.version-compare"),
      description:
        "Side-by-side per-version comparison of KPIs (starts, durations of the instances that ended; incident rates are not measured per version) across two process versions.",
      requires: [],
      consumes: ["analytics:versionCompare"],
      size: "full",
    },
    {
      id: "analytics:engine-compare",
      ...builderText("widget.engine-compare"),
      description:
        "Side-by-side comparison of KPIs (starts, incident rate, durations of the instances that ended) for ONE process definition as it runs on two engines (e.g. prod-a vs prod-b). Requires a processDefinitionKey — see analytics:engine-landscape for which definitions qualify.",
      requires: [],
      consumes: ["analytics:engineCompare"],
      size: "full",
    },
    {
      id: "analytics:engine-landscape",
      ...builderText("widget.engine-landscape"),
      description:
        "Cross-engine overview: the process × engine inventory matrix, absolute load per engine (running instances, incidents, failed jobs) and the process-independent job backlog. Counts rather than rates, because engines run different process mixes; highlights the definitions deployed on several engines as the valid comparison targets.",
      requires: [],
      consumes: ["analytics:engineLandscape"],
      size: "full",
      propsSchema: engineLandscapePropsSchema,
    },
    {
      id: "analytics:bpmn-heatmap",
      ...builderText("widget.bpmn-heatmap"),
      description:
        "BPMN diagram with a per-element heat overlay from metrics, toggling between traversal frequency and average duration. Node-only; rendered on the latest deployed version's diagram.",
      requires: [],
      consumes: ["analytics:bpmnHeatmap"],
      size: "full",
    },
    {
      id: "analytics:settings",
      ...builderText("widget.settings"),
      description:
        "The analytics module's settings section: default look-back period and minimum comparison bucket size, applied when analytics calls omit them.",
      requires: [],
      consumes: ["analytics:settings"],
      size: "full",
    },
  ],
}
