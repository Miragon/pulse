import { ViewStack, type ViewProps } from "@miragon/pulse-widget-shell/widgets"
import { ActivityBottleneckTable } from "./activity-bottleneck-table.js"
import { ProcessDefinitionBreakdown } from "./definition-breakdown.js"
import { ExecutionPerformanceKpi } from "./execution-performance-kpi.js"
import { ExecutionSummaryKpi } from "./execution-summary-kpi.js"
import type { DashboardView } from "./lib.js"

/** `analytics_show_dashboard`: each part brings its own shell; the tool result gives the model the figures. */
export function AnalyticsDashboardView({ data }: ViewProps<DashboardView>) {
  return (
    <ViewStack>
      <ExecutionSummaryKpi data={data} />
      <ExecutionPerformanceKpi data={data} />
      <ProcessDefinitionBreakdown data={data} />
      <ActivityBottleneckTable data={data} />
    </ViewStack>
  )
}
