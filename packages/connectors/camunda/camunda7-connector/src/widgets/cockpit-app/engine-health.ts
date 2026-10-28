import { useToolQuery, type ToneVariant } from "@miragon/mcp-toolkit-ui"
import { severityTone } from "@miragon/pulse-widget-shell/widgets"
import type { CockpitDashboardData } from "../../view-models.js"
import { CAMUNDA7_COCKPIT_OVERVIEW_DATA } from "../../tool-names.js"

/** Same query key as the engine's own overview, so a drill-in lands on a warm cache; an idle engine must not read as green. */
export function useEngineHealth(engineId: string) {
  const query = useToolQuery<CockpitDashboardData>(
    ["camunda7:cockpit-overview", engineId],
    CAMUNDA7_COCKPIT_OVERVIEW_DATA,
    { engine: engineId },
  )
  const summary = query.data?.summary
  const incidents = summary?.totalIncidents ?? 0
  const failed = summary?.totalFailedJobs ?? 0
  const tone: ToneVariant = severityTone(failed, incidents, summary?.totalRunningInstances ?? 0)
  return { query, summary, incidents, failed, tone }
}
