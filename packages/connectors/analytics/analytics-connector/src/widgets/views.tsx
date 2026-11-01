import {
  HostModelContext,
  type HostWidgets,
  type ViewMap,
  type ViewProps,
} from "@miragon/pulse-widget-shell/widgets"
import type {
  ClusterCompareResult,
  EngineCompareResult,
  VersionCompareResult,
} from "@miragon/pulse-analytics-client"
import {
  ANALYTICS_SHOW_BPMN_HEATMAP,
  ANALYTICS_SHOW_CLUSTER_COMPARE,
  ANALYTICS_SHOW_DASHBOARD,
  ANALYTICS_SHOW_ENGINE_COMPARE,
  ANALYTICS_SHOW_ENGINE_LANDSCAPE,
  ANALYTICS_SHOW_FAILURE_DASHBOARD,
  ANALYTICS_SHOW_VERSION_COMPARE,
} from "../tool-names.js"
import { AnalyticsDashboardView } from "./analytics-dashboard/view.js"
import { AnalyticsBpmnHeatmap, type AnalyticsBpmnHeatmapData } from "./bpmn-heatmap.js"
import { ClusterCompareWidget } from "./cluster-compare.js"
import { EngineCompareWidget } from "./engine-compare.js"
import { EngineLandscapeWidget, type EngineLandscapeView } from "./engine-landscape.js"
import { FailureDashboardView } from "./failure-dashboard/view.js"
import {
  describeBpmnHeatmap,
  describeClusterCompare,
  describeEngineCompare,
  describeEngineLandscape,
  describeVersionCompare,
} from "./model-descriptions.js"
import { VersionCompareWidget } from "./version-compare.js"

function ClusterCompareView({ data }: ViewProps<ClusterCompareResult>) {
  return (
    <HostModelContext content={describeClusterCompare(data)}>
      <ClusterCompareWidget data={data} />
    </HostModelContext>
  )
}

function VersionCompareView({ data }: ViewProps<VersionCompareResult>) {
  return (
    <HostModelContext content={describeVersionCompare(data)}>
      <VersionCompareWidget data={data} />
    </HostModelContext>
  )
}

function EngineCompareView({ data }: ViewProps<EngineCompareResult>) {
  return (
    <HostModelContext content={describeEngineCompare(data)}>
      <EngineCompareWidget data={data} />
    </HostModelContext>
  )
}

function EngineLandscapeView({ data }: ViewProps<EngineLandscapeView>) {
  return (
    <HostModelContext content={describeEngineLandscape(data)}>
      <EngineLandscapeWidget data={data} />
    </HostModelContext>
  )
}

function BpmnHeatmapView({ data }: ViewProps<AnalyticsBpmnHeatmapData>) {
  return (
    <HostModelContext content={describeBpmnHeatmap(data)}>
      <AnalyticsBpmnHeatmap data={data} />
    </HostModelContext>
  )
}

/** The analytics views by view name (= show tool name). */
export const analyticsViews: ViewMap = {
  [ANALYTICS_SHOW_DASHBOARD]: AnalyticsDashboardView,
  [ANALYTICS_SHOW_FAILURE_DASHBOARD]: FailureDashboardView,
  [ANALYTICS_SHOW_CLUSTER_COMPARE]: ClusterCompareView,
  [ANALYTICS_SHOW_VERSION_COMPARE]: VersionCompareView,
  [ANALYTICS_SHOW_ENGINE_COMPARE]: EngineCompareView,
  [ANALYTICS_SHOW_ENGINE_LANDSCAPE]: EngineLandscapeView,
  [ANALYTICS_SHOW_BPMN_HEATMAP]: BpmnHeatmapView,
}

function isEngineList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === "string")
}

/**
 * camunda7's fleet view renders the landscape by its raw id with `{ engine: string[] }`, every
 * configured engine, so an engine without metrics still shows. Anything else is no engine list:
 * the landscape then reads every engine.
 */
export function FleetLandscape(props: Record<string, unknown>) {
  const engine = isEngineList(props.engine) ? props.engine : undefined
  return <EngineLandscapeWidget data={null} engine={engine} />
}

/** Rendered by raw id from another module: camunda7's fleet view. */
export const analyticsHostWidgets: HostWidgets = {
  "analytics:engine-landscape": FleetLandscape,
}
