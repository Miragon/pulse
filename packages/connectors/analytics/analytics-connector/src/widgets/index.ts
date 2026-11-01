import type { AnalyticsDashboardData, FailureDashboardData } from "@miragon/pulse-analytics-client"
import type { BpmnHeatmapData } from "@miragon/pulse-widget-shell/widgets"
import type { ClusterCompareData } from "./cluster-compare.js"
import type { VersionCompareData } from "./version-compare.js"
import type { EngineCompareData } from "./engine-compare.js"
import type { EngineLandscapeData } from "./engine-landscape.js"
import type { AnalyticsBpmnHeatmapData } from "./bpmn-heatmap.js"

export { analyticsHostWidgets, analyticsViews } from "./views.js"

export type {
  AnalyticsDashboardData,
  FailureDashboardData,
  ClusterCompareData,
  VersionCompareData,
  EngineCompareData,
  EngineLandscapeData,
  BpmnHeatmapData,
  AnalyticsBpmnHeatmapData,
}
