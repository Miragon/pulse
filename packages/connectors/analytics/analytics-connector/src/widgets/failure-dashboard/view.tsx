import { HostModelContext, ViewStack, type ViewProps } from "@miragon/pulse-widget-shell/widgets"
import {
  describeErrorPatterns,
  describeFailureRates,
  describeFailureSummary,
} from "../model-descriptions.js"
import { ErrorPatternsTable } from "./error-patterns-table.js"
import { FailureRateTable } from "./failure-rate-table.js"
import type { FailureView } from "./lib.js"
import { FailureSummaryKpi } from "./summary-kpi.js"

/** `analytics_show_failure_dashboard`: each part brings its own shell and tells the model what it shows. */
export function FailureDashboardView({ data }: ViewProps<FailureView>) {
  return (
    <ViewStack>
      <HostModelContext content={describeFailureSummary(data)}>
        <FailureSummaryKpi data={data} />
      </HostModelContext>
      <HostModelContext content={describeErrorPatterns(data)}>
        <ErrorPatternsTable data={data} />
      </HostModelContext>
      <HostModelContext content={describeFailureRates(data)}>
        <FailureRateTable data={data} />
      </HostModelContext>
    </ViewStack>
  )
}
