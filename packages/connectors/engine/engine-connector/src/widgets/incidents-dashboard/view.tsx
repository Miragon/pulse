import { ViewStack } from "@miragon/pulse-widget-shell/widgets"
import type { IncidentsDashboardData } from "../../view-models.js"
import { IncidentsBar } from "./incidents-bar.js"
import { IncidentProcessList } from "./process-list.js"

/** The incidents dashboard, the cockpit's incidents route: its bar over the per-process list. */
export function IncidentsDashboard({
  data = null,
  engine,
}: {
  data?: IncidentsDashboardData | null
  engine: string
}) {
  return (
    <ViewStack>
      <IncidentsBar data={data} engine={engine} />
      <IncidentProcessList data={data} engine={engine} />
    </ViewStack>
  )
}
