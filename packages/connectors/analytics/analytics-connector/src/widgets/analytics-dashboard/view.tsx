import { HostModelContext, ViewStack, type ViewProps } from "@miragon/pulse-widget-shell/widgets"
import {
  describeActivityBottlenecks,
  describeDefinitionBreakdown,
  describeExecutionPerformance,
  describeExecutionSummary,
} from "../model-descriptions.js"
import { ActivityBottleneckTable } from "./activity-bottleneck-table.js"
import { ProcessDefinitionBreakdown } from "./definition-breakdown.js"
import { ExecutionPerformanceKpi } from "./execution-performance-kpi.js"
import { ExecutionSummaryKpi } from "./execution-summary-kpi.js"
import type { DashboardView } from "./lib.js"

/** `analytics_show_dashboard`: each part brings its own shell and tells the model what it shows. */
export function AnalyticsDashboardView({ data }: ViewProps<DashboardView>) {
  return (
    <ViewStack>
      <HostModelContext content={describeExecutionSummary(data)}>
        <ExecutionSummaryKpi data={data} />
      </HostModelContext>
      <HostModelContext content={describeExecutionPerformance(data)}>
        <ExecutionPerformanceKpi data={data} />
      </HostModelContext>
      <HostModelContext content={describeDefinitionBreakdown(data)}>
        <ProcessDefinitionBreakdown data={data} />
      </HostModelContext>
      <HostModelContext content={describeActivityBottlenecks(data)}>
        <ActivityBottleneckTable data={data} />
      </HostModelContext>
    </ViewStack>
  )
}
