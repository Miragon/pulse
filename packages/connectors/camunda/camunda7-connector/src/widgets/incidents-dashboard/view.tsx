import { ViewStack } from "@miragon/pulse-widget-shell/widgets"
import type { IncidentsDashboardData } from "../../view-models.js"
import { IncidentOverviewKpi } from "./overview-kpi.js"
import { IncidentProcessList } from "./process-list.js"

/** The incidents dashboard, for its show tool and the cockpit route: KPIs over the per-process list. */
export function IncidentsDashboard({
  data = null,
  engine,
}: {
  data?: IncidentsDashboardData | null
  engine?: string
}) {
  return (
    <ViewStack>
      <IncidentOverviewKpi data={data} engine={engine} />
      <IncidentProcessList data={data} engine={engine} />
    </ViewStack>
  )
}
