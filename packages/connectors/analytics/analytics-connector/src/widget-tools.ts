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
  type PrometheusClient,
} from "@miragon/pulse-analytics-client"
import {
  ANALYTICS_BPMN_HEATMAP_DATA,
  ANALYTICS_BPMN_XML_DATA,
  ANALYTICS_SHOW_BPMN_HEATMAP,
  ANALYTICS_SHOW_DASHBOARD,
} from "./tool-names.js"
import { summaryT as t } from "./summary.js"
import { registerComparisonWidgetTools } from "./widget-tools/comparisons.js"
import { viewWithJson } from "./widget-tools/shared.js"
import { isFleetRequest, withEngineScope, type AnalyticsEngineScope } from "./engine-ids.js"
import type { BpmnMissingReason } from "./heatmap-data.js"
import { NO_NAMES, type FetchBpmnXml, type NameLookup } from "./bpmn-name-lookup.js"
import { namedDashboard } from "./named-views.js"

export type { FetchBpmnXml } from "./bpmn-name-lookup.js"

/**
 * One engine by name, or every engine a fleet aggregate adds up, so a fleet figure never reads as
 * one engine's (the heatmap's summary; the engine scope never resolves to no engine).
 */
function engineScopeSummary(engines: readonly string[], fleet: boolean): string {
  const ids = engines.map((id) => `"${id}"`).join(", ")
  if (fleet) return t("aSum.engineScopeFleet", { count: engines.length, ids })
  return engines.length === 1
    ? t("aSum.engineScopeOne", { id: engines[0] })
    : t("aSum.engineScopeSubset", { ids })
}

export interface AnalyticsWidgetToolsOptions {
  engineScope: AnalyticsEngineScope
  /** Absent → the heatmap's non-diagram fallback. */
  fetchBpmnXml?: FetchBpmnXml
  /** Absent → the dashboard and the landscape list ids. */
  namesFor?: NameLookup
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
        "Show process metrics from Prometheus for a rolling period: starts, completions, incidents created (not failed instances) and resolved, avg/median/p95 duration of the instances that ENDED in it (null when none did), the period before as reference, and the live state now (instances running, incidents open). Broken down per process definition and per (process, activity): executions, total/avg/median/p95 time and incidents created (unscoped: the top 20 by total time).",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: strictToolInput(schemas.dashboardInput.shape),
      ...showToolBinding(ANALYTICS_SHOW_DASHBOARD, "Process Analytics Dashboard"),
    },
    withToolErrors(async (args, ctx) => {
      const result = await queries.dashboardData(
        withCallerSignal(ch, ctx.signal),
        withEngineScope(engineScope, args),
      )
      return viewWithJson(await namedDashboard(result, namesFor), result)
    }),
  )

  registerComparisonWidgetTools({ server, ch, engineScope, namesFor })

  server.tool(
    {
      name: ANALYTICS_SHOW_BPMN_HEATMAP,
      title: "BPMN Heatmap",
      description:
        "Render a process definition's BPMN diagram with a per-element heat overlay from metrics, with a Frequency↔Duration toggle (traversal count vs average duration per element). Node-level only (sequence-flow/edge heat is not available from metrics) and rendered on the latest deployed version's diagram (activity metrics carry no version label). Needs the camunda7 client to fetch the BPMN XML; otherwise the widget shows a fallback.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: strictToolInput(schemas.heatmapInput.shape),
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
          durationMs: heat.durationMs,
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
        "Internal JSON feed (no UI) for the BPMN heatmap: per-element execution frequency + average duration over a window. Lets another widget (e.g. the CIB seven cockpit) paint the heat on its own diagram. Prefer analytics_show_bpmn_heatmap for a standalone view.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: strictToolInput(schemas.heatmapInput.shape),
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
        durationMs: heat.durationMs,
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
        processDefinitionKey: schemas.heatmapInput.shape.processDefinitionKey,
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
