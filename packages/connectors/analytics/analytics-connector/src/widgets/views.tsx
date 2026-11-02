import {
  HostModelContext,
  type HostWidgets,
  type ViewMap,
  type ViewProps,
} from "@miragon/pulse-widget-shell/widgets"
import {
  ANALYTICS_SHOW_BPMN_HEATMAP,
  ANALYTICS_SHOW_DASHBOARD,
  ANALYTICS_SHOW_ENGINE_COMPARE,
  ANALYTICS_SHOW_ENGINE_LANDSCAPE,
  ANALYTICS_SHOW_PERIOD_COMPARE,
  ANALYTICS_SHOW_VERSION_COMPARE,
} from "../tool-names.js"
import { AnalyticsDashboardView } from "./analytics-dashboard/view.js"
import { AnalyticsBpmnHeatmap, type AnalyticsBpmnHeatmapData } from "./bpmn-heatmap.js"
import { EngineCompareWidget } from "./engine-compare.js"
import { EngineLandscapeWidget } from "./engine-landscape.js"
import { describeBpmnHeatmap } from "./model-descriptions.js"
import { PeriodCompareWidget } from "./period-compare.js"
import { VersionCompareWidget } from "./version-compare.js"

/** The heatmap's tool result is a summary, so the view tells the model what it shows. */
function BpmnHeatmapView({ data }: ViewProps<AnalyticsBpmnHeatmapData>) {
  return (
    <HostModelContext content={describeBpmnHeatmap(data)}>
      <AnalyticsBpmnHeatmap data={data} />
    </HostModelContext>
  )
}

/**
 * The analytics views by view name (= show tool name). Every view but the heatmap returns its
 * figures to the model in the tool result, so it needs no model context.
 */
export const analyticsViews: ViewMap = {
  [ANALYTICS_SHOW_DASHBOARD]: AnalyticsDashboardView,
  [ANALYTICS_SHOW_PERIOD_COMPARE]: PeriodCompareWidget,
  [ANALYTICS_SHOW_VERSION_COMPARE]: VersionCompareWidget,
  [ANALYTICS_SHOW_ENGINE_COMPARE]: EngineCompareWidget,
  [ANALYTICS_SHOW_ENGINE_LANDSCAPE]: EngineLandscapeWidget,
  [ANALYTICS_SHOW_BPMN_HEATMAP]: BpmnHeatmapView,
}

function isEngineList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === "string")
}

/**
 * the engine module's fleet view renders the landscape by its raw id with `{ engine: string[] }`, every
 * configured engine, so an engine without metrics still shows. Anything else is no engine list:
 * the landscape then reads every engine.
 */
export function FleetLandscape(props: Record<string, unknown>) {
  const engine = isEngineList(props.engine) ? props.engine : undefined
  return <EngineLandscapeWidget data={null} engine={engine} />
}

/** Rendered by raw id from another module: the engine module's fleet view. */
export const analyticsHostWidgets: HostWidgets = {
  "analytics:engine-landscape": FleetLandscape,
}
