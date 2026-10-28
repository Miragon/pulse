import { useToolQuery } from "@miragon/mcp-toolkit-ui"
import type {
  AnalyticsDashboardData,
  EngineFilterInput,
  Period,
} from "@miragon/pulse-analytics-client"
import { ANALYTICS_DASHBOARD_DATA } from "../../tool-names.js"
import type { Named } from "../../bpmn-names.js"

export type DashboardView = Named<AnalyticsDashboardData>

export interface DashboardScopeProps {
  processDefinitionKey?: string
  period?: Period
  /** Omitted = every configured engine. */
  engine?: EngineFilterInput
}

// The cache key holds every scope prop so an engine-scoped cell never reads a fleet-wide entry.
// The *_data feed, not show_*: hosts honoring resultCanProduceWidget may render a second widget.
export function useDashboardSelfFetch(
  initialData: DashboardView | null,
  props: DashboardScopeProps,
) {
  const { processDefinitionKey, period, engine } = props
  const queryArgs: DashboardScopeProps = {}
  if (processDefinitionKey) queryArgs.processDefinitionKey = processDefinitionKey
  if (period) queryArgs.period = period
  if (engine !== undefined) queryArgs.engine = engine
  return useToolQuery<DashboardView>(
    ["analytics:dashboard", processDefinitionKey ?? null, period ?? null, engine ?? null],
    ANALYTICS_DASHBOARD_DATA,
    queryArgs,
    { enabled: !initialData },
  )
}
