import { adaptDataWidget } from "@miragon/pulse-widget-shell/ui"
import type { WidgetComponent } from "@miragon/mcp-toolkit-ui/app"
import type {
  IncidentsDashboardData,
  ProcessIncidentsData,
  CockpitDashboardData,
  BpmnViewerData,
} from "../view-models.js"
import type { ProcessListData } from "./process-list.js"
import type { IncidentDetailData } from "./incident-detail.js"
import type { HistoryTimelineData } from "./history-timeline.js"
import type { InstanceDetailData } from "./instance-detail.js"
import type { JobPanelData } from "./job-panel.js"
import type { ProcessInstancesData } from "./process-instances/list.js"
import { camunda7BaseWidgets } from "./registry.js"
import { CockpitApp } from "./cockpit-app/app.js"

export { Camunda7StandaloneShell } from "./standalone-shell.js"

// Exported so a composition root can assert the settings tab renders the shell's page (the app's `widget-registry.test.ts`).
export { cockpitViews } from "./cockpit-app/views.js"

export type {
  ProcessListData,
  IncidentsDashboardData,
  ProcessIncidentsData,
  IncidentDetailData,
  HistoryTimelineData,
  InstanceDetailData,
  CockpitDashboardData,
  BpmnViewerData,
  JobPanelData,
  ProcessInstancesData,
}

// The cockpit app is added only here to avoid an import cycle with the base map it renders.
export const camunda7Widgets: Record<string, WidgetComponent> = {
  ...camunda7BaseWidgets,
  "camunda7:cockpit-app": adaptDataWidget(CockpitApp, "camunda7:cockpitApp"),
}
