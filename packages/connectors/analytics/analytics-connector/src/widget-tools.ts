import type { MCPServer } from "mcp-use"
import {
  appOnly,
  buildDataFeedResult,
  buildViewResult,
  showToolBinding,
  withToolErrors,
  strictToolInput,
} from "@miragon/pulse-widget-shell/server"
import {
  queries,
  schemas,
  withCallerSignal,
  type AnalyticsDashboardData,
  type PrometheusClient,
} from "@miragon/pulse-analytics-client"
import {
  ANALYTICS_BPMN_HEATMAP_DATA,
  ANALYTICS_BPMN_XML_DATA,
  ANALYTICS_SHOW_BPMN_HEATMAP,
  ANALYTICS_SHOW_DASHBOARD,
  ANALYTICS_SHOW_FAILURE_DASHBOARD,
} from "./tool-names.js"
import { summaryT as t } from "./summary.js"
import { registerComparisonWidgetTools } from "./widget-tools/comparisons.js"
import { engineScopeSummary } from "./widget-tools/shared.js"
import { isFleetRequest, withEngineScope, type AnalyticsEngineScope } from "./engine-ids.js"
import type { BpmnMissingReason } from "./heatmap-data.js"
import { NO_NAMES, type FetchBpmnXml, type NameLookup } from "./bpmn-name-lookup.js"
import { namedDashboard, namedFailureDashboard } from "./named-views.js"

export type { FetchBpmnXml } from "./bpmn-name-lookup.js"

export interface AnalyticsWidgetToolsOptions {
  engineScope: AnalyticsEngineScope
  /** Absent → the heatmap's non-diagram fallback. */
  fetchBpmnXml?: FetchBpmnXml
  /** Absent → the dashboards list ids. */
  namesFor?: NameLookup
}

/** Composed from the client schemas so the describe() texts stay in one place. */
const heatmapInputShape = {
  processDefinitionKey: schemas.elementBottleneckInput.shape.processDefinitionKey,
  period: schemas.periodField,
  ...schemas.engineFilterShape,
}

const dashboardInputShape = {
  processDefinitionKey: schemas.clusterCompareInput.shape.processDefinitionKey,
  period: schemas.periodField,
  ...schemas.engineFilterShape,
}

/** Never a plausible 0. */
const orNa = (value: number | null) => value ?? "n/a"

/** Window flows and the live state, never mixed. */
function dashboardSummary(data: AnalyticsDashboardData, fleet: boolean): string {
  return t("aSum.dashboard", {
    scope: data.processDefinitionKey
      ? t("aSum.scopeForProcess", { key: data.processDefinitionKey })
      : "",
    period: data.period,
    engines: engineScopeSummary(data.engines, fleet),
    totalCount: data.totalCount,
    completedCount: data.completedCount,
    incidentsCreated: data.incidentsCreated,
    incidentRatePct: orNa(data.incidentRatePct),
    runningNow: orNa(data.runningNow),
    openIncidentsNow: orNa(data.openIncidentsNow),
  })
}

export function registerWidgetTools(
  server: MCPServer,
  ch: PrometheusClient,
  options: AnalyticsWidgetToolsOptions,
) {
  const { engineScope } = options
  const namesFor = options.namesFor ?? NO_NAMES

  /**
   * The first engine (config order) that has the model draws it, so a process
   * on a later engine still gets its diagram; `bpmnMissing` names why none did.
   */
  async function loadBpmn(
    processDefinitionKey: string,
    engines: readonly string[],
  ): Promise<{ bpmnXml: string | null; bpmnMissing?: BpmnMissingReason }> {
    const fetchBpmnXml = options.fetchBpmnXml
    if (!fetchBpmnXml) return { bpmnXml: null, bpmnMissing: "no-camunda7" }
    for (const engine of engines.length > 0 ? engines : [undefined]) {
      const bpmnXml = await fetchBpmnXml(processDefinitionKey, engine).catch(() => null)
      if (bpmnXml) return { bpmnXml }
    }
    return { bpmnXml: null, bpmnMissing: "not-loaded" }
  }

  server.tool(
    {
      name: ANALYTICS_SHOW_DASHBOARD,
      title: "Process Analytics Dashboard",
      description:
        "Show process metrics from Prometheus: flows within the period (starts, completions, incidents created/resolved, durations of the instances that ended) and the live state right now (instances running, incidents open), per process definition and per (process, activity).",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: strictToolInput(dashboardInputShape),
      ...showToolBinding(ANALYTICS_SHOW_DASHBOARD, "Process Analytics Dashboard"),
    },
    withToolErrors(async (args, ctx) => {
      const data = await namedDashboard(
        await queries.dashboardData(
          withCallerSignal(ch, ctx.signal),
          withEngineScope(engineScope, args),
        ),
        namesFor,
      )
      return buildViewResult(data, dashboardSummary(data, isFleetRequest(args.engine)))
    }),
  )

  server.tool(
    {
      name: ANALYTICS_SHOW_FAILURE_DASHBOARD,
      title: "Failure Analysis Dashboard",
      description:
        "Show the incidents open right now from Prometheus, grouped by incident type and process definition (no activity, message or timestamps), with each affected process's running instances and dead jobs. Use to show the metric view to the user; for one engine's live incident clusters use camunda7_show_engine_health.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: strictToolInput({
        ...schemas.engineFilterShape,
      }),
      ...showToolBinding(ANALYTICS_SHOW_FAILURE_DASHBOARD, "Failure Analysis Dashboard"),
    },
    withToolErrors(async (args, ctx) => {
      const data = await namedFailureDashboard(
        await queries.failureDashboardData(
          withCallerSignal(ch, ctx.signal),
          withEngineScope(engineScope, args),
        ),
        namesFor,
      )
      return buildViewResult(
        data,
        t("aSum.failureDashboard", {
          engines: engineScopeSummary(data.engines, isFleetRequest(args.engine)),
          totalIncidents: data.totalIncidents,
          uniqueErrorPatterns: data.uniqueErrorPatterns,
          mostAffected: data.mostAffectedProcess
            ? t("aSum.mostAffectedProcess", { key: data.mostAffectedProcess })
            : "",
        }),
      )
    }),
  )

  registerComparisonWidgetTools({ server, ch, engineScope, namesFor })

  server.tool(
    {
      name: ANALYTICS_SHOW_BPMN_HEATMAP,
      title: "BPMN Heatmap",
      description:
        "Render a process definition's BPMN diagram with a per-element heat overlay from metrics, with a Frequency↔Duration toggle (traversal count vs average duration per element). Node-level only — sequence-flow/edge heat is not available from metrics — and rendered on the latest deployed version's diagram (activity metrics carry no version label). Needs the camunda7 client to fetch the BPMN XML; otherwise the widget shows a fallback.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: strictToolInput(heatmapInputShape),
      ...showToolBinding(ANALYTICS_SHOW_BPMN_HEATMAP, "BPMN Heatmap"),
    },
    withToolErrors(async (args, ctx) => {
      const { period } = args
      const scoped = withEngineScope(engineScope, args)
      const heat = await queries.elementHeat(withCallerSignal(ch, ctx.signal), scoped)
      // Only to know whether a diagram exists; the widget reads the XML from `analytics_bpmn_xml_data`.
      const bpmn = await loadBpmn(args.processDefinitionKey, scoped.engine)
      // The engines travel with the heat, so the model description names them.
      return buildViewResult(
        {
          processDefinitionKey: args.processDefinitionKey,
          period,
          engines: scoped.engine,
          ...(bpmn.bpmnMissing ? { bpmnMissing: bpmn.bpmnMissing } : {}),
          frequency: heat.frequency,
          durationSec: heat.durationSec,
          asOf: heat.asOf,
        },
        t("aSum.bpmnHeatmap", {
          key: args.processDefinitionKey,
          period,
          engines: engineScopeSummary(scoped.engine, isFleetRequest(args.engine)),
          elementCount: Object.keys(heat.frequency).length,
          fallbackNote: bpmn.bpmnXml ? "" : t("aSum.bpmnHeatmapNoXml"),
        }),
      )
    }),
  )

  server.tool(
    {
      name: ANALYTICS_BPMN_HEATMAP_DATA,
      title: "BPMN heatmap data (internal)",
      description:
        "Internal JSON feed (no UI) for the BPMN heatmap — per-element execution frequency + average duration over a window. Lets another widget (e.g. the CIB Seven cockpit) paint the heat on its own diagram. Prefer analytics_show_bpmn_heatmap for a standalone view.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: strictToolInput(heatmapInputShape),
      ...appOnly,
    },
    withToolErrors(async (args, ctx) => {
      const { period } = args
      const scoped = withEngineScope(engineScope, args)
      const heat = await queries.elementHeat(withCallerSignal(ch, ctx.signal), scoped)
      const data = {
        processDefinitionKey: args.processDefinitionKey,
        period,
        engines: scoped.engine,
        frequency: heat.frequency,
        durationSec: heat.durationSec,
        asOf: heat.asOf,
      }
      return buildDataFeedResult(data)
    }),
  )

  server.tool(
    {
      name: ANALYTICS_BPMN_XML_DATA,
      title: "BPMN heatmap diagram (internal)",
      description:
        "Internal JSON feed (no UI): the latest deployed BPMN XML of a process key on the engines in scope, for the heatmap view's diagram.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: strictToolInput({
        processDefinitionKey: heatmapInputShape.processDefinitionKey,
        ...schemas.engineFilterShape,
      }),
      ...appOnly,
    },
    withToolErrors(async (args) => {
      const scoped = withEngineScope(engineScope, args)
      return buildDataFeedResult({
        processDefinitionKey: args.processDefinitionKey,
        ...(await loadBpmn(args.processDefinitionKey, scoped.engine)),
      })
    }),
  )
}
