import type {
  IncidentsDashboardData,
  ProcessIncidentsData,
  CockpitDashboardData,
} from "../view-models.js"
import type { IncidentDetailData } from "./incident-detail.js"
import type { HistoryTimelineData } from "./history-timeline.js"
import type { InstanceDetailData } from "./instance-detail.js"
import type { JobPanelData } from "./job-panel.js"
import type { ProcessInstancesData } from "./process-instances/list.js"
import { ENGINE_LANDSCAPE_WIDGET } from "./cockpit-app/fleet-view.js"

export { engineViews } from "./views.js"

/** Other modules' host widgets the engine module renders by raw id; a composition root checks each exists. */
export const ENGINE_HOST_WIDGET_REFS = [ENGINE_LANDSCAPE_WIDGET] as const

export type {
  IncidentsDashboardData,
  ProcessIncidentsData,
  IncidentDetailData,
  HistoryTimelineData,
  InstanceDetailData,
  CockpitDashboardData,
  JobPanelData,
  ProcessInstancesData,
}
