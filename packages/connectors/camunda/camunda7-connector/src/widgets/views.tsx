import type { ComponentType } from "react"
import type {
  HostWidgets,
  ViewComponent,
  ViewMap,
  ViewProps,
} from "@miragon/pulse-widget-shell/widgets"
import type {
  BpmnViewerData,
  IncidentsDashboardData,
  ProcessIncidentsData,
} from "../view-models.js"
import type { ClusterDetailData, EngineHealthData } from "../view-models.health.js"
import type { UserProfileView } from "../lib/profile-schema.js"
import {
  CAMUNDA7_OPEN_COCKPIT,
  CAMUNDA7_SHOW_BPMN_VIEWER,
  CAMUNDA7_SHOW_CLUSTER_DETAIL,
  CAMUNDA7_SHOW_ENGINE_HEALTH,
  CAMUNDA7_SHOW_HISTORY_TIMELINE,
  CAMUNDA7_SHOW_INCIDENT_DETAIL,
  CAMUNDA7_SHOW_INCIDENTS_DASHBOARD,
  CAMUNDA7_SHOW_INSTANCE_DETAIL,
  CAMUNDA7_SHOW_JOB_PANEL,
  CAMUNDA7_SHOW_PROCESS_DETAIL,
  CAMUNDA7_SHOW_PROCESS_INCIDENTS,
  CAMUNDA7_SHOW_PROCESS_INSTANCES,
  CAMUNDA7_SHOW_PROCESS_LIST,
  CAMUNDA7_SHOW_SETTINGS,
} from "../tool-names.js"
import { BpmnViewerWidget } from "./bpmn-viewer/widget.js"
import { ClusterDetailWidget } from "./cluster-detail.js"
import { CockpitApp } from "./cockpit-app/app.js"
import { EngineHealthVerdict } from "./engine-health.js"
import { HistoryTimelineWidget, type HistoryTimelineData } from "./history-timeline.js"
import { IncidentDetailWidget, type IncidentDetailData } from "./incident-detail.js"
import { IncidentsDashboard } from "./incidents-dashboard/view.js"
import { InstanceDetailWidget, type InstanceDetailData } from "./instance-detail.js"
import { JobPanelWidget, type JobPanelData } from "./job-panel.js"
import { ProcessDefinitionView } from "./process-incidents/view.js"
import { ProcessInstancesWidget, type ProcessInstancesData } from "./process-instances/list.js"
import { ProcessListWidget, type ProcessListData } from "./process-list.js"
import { Camunda7Standalone } from "./standalone.js"
import { UserProfileWidget } from "./user-profile.js"

/** A camunda7 view on its show tool's data, with the client-side drill-in of `Camunda7Standalone`. */
function standalone<TData extends { engineId?: string | null }>(
  Widget: ComponentType<{ data: TData }>,
): ViewComponent<TData> {
  return function StandaloneView({ data }) {
    return (
      <Camunda7Standalone engineId={data.engineId}>
        <Widget data={data} />
      </Camunda7Standalone>
    )
  }
}

function ProcessIncidentsFocus({ data }: { data: ProcessIncidentsData }) {
  return <ProcessDefinitionView data={data} focus="incidents" />
}

function SettingsView({ data }: ViewProps<UserProfileView>) {
  return <UserProfileWidget data={data} />
}

/**
 * The camunda7 views by view name (= show tool name). The cockpit routes itself; every other view
 * gets the client-side drill-in of `Camunda7Standalone`.
 */
export const camunda7Views: ViewMap = {
  [CAMUNDA7_OPEN_COCKPIT]: CockpitApp,
  [CAMUNDA7_SHOW_PROCESS_LIST]: standalone<ProcessListData>(ProcessListWidget),
  [CAMUNDA7_SHOW_PROCESS_INSTANCES]: standalone<ProcessInstancesData>(ProcessInstancesWidget),
  [CAMUNDA7_SHOW_PROCESS_DETAIL]: standalone<ProcessIncidentsData>(ProcessDefinitionView),
  [CAMUNDA7_SHOW_PROCESS_INCIDENTS]: standalone<ProcessIncidentsData>(ProcessIncidentsFocus),
  [CAMUNDA7_SHOW_INCIDENTS_DASHBOARD]: standalone<IncidentsDashboardData>(IncidentsDashboard),
  [CAMUNDA7_SHOW_INCIDENT_DETAIL]: standalone<IncidentDetailData>(IncidentDetailWidget),
  [CAMUNDA7_SHOW_HISTORY_TIMELINE]: standalone<HistoryTimelineData>(HistoryTimelineWidget),
  [CAMUNDA7_SHOW_INSTANCE_DETAIL]: standalone<InstanceDetailData>(InstanceDetailWidget),
  [CAMUNDA7_SHOW_ENGINE_HEALTH]: standalone<EngineHealthData>(EngineHealthVerdict),
  [CAMUNDA7_SHOW_CLUSTER_DETAIL]: standalone<ClusterDetailData>(ClusterDetailWidget),
  [CAMUNDA7_SHOW_BPMN_VIEWER]: standalone<BpmnViewerData>(BpmnViewerWidget),
  [CAMUNDA7_SHOW_JOB_PANEL]: standalone<JobPanelData>(JobPanelWidget),
  [CAMUNDA7_SHOW_SETTINGS]: SettingsView,
}

/** The shell's settings page renders this section by its `<module>:settings` id. */
function Camunda7SettingsSection() {
  return <UserProfileWidget />
}

export const camunda7HostWidgets: HostWidgets = {
  "camunda7:settings": Camunda7SettingsSection,
}
