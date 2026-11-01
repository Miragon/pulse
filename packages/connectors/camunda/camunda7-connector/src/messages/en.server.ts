import type { MessageCatalog } from "@miragon/pulse-widget-shell/server"

/** The show tools' summaries for the model (`lib/summary.ts`); the model may quote them, so the voice rules apply too. */
export const enServer: MessageCatalog = {
  "c7sum.cockpitOpened":
    'Operations cockpit for engine "{engineId}" ({engineCount} configured engine(s)). Where the host shows the view, the user navigates the process landscape in it.',
  "c7sum.cockpitOpenedPicker":
    "Operations cockpit at its engine picker: {engineCount} configured engine(s), none preselected (no `engine` passed, no default engine configured). Where the host shows the view, the user picks one there; pass `engine` to open it on a specific engine.",
  "c7sum.processList":
    'Process list: {totalCount} deployed definition(s){filters} on engine "{engineId}".',
  "c7sum.state.active": "running",
  "c7sum.state.suspended": "suspended",
  "c7sum.state.ended": "ended",
  "c7sum.instanceDetail":
    "Process instance {instanceId}{businessKey}: {state}; running activities: {activeActivities}, open incidents: {openIncidents}, open user tasks: {openTasks}.",
  "c7sum.processInstances":
    '{totalCount} running instance(s) of "{processDefinitionKey}", of them {withIncidentCount} with incidents and {suspendedCount} suspended; this page holds {returnedCount}.',
  "c7sum.incidentsDashboard":
    "Incidents dashboard: {totalCount} open incident(s) across {processCount} process definition(s), {last24hCount} in the last 24h.",
  "c7sum.processIncidents":
    'Process incidents for "{processDefinitionKey}" (all versions; diagram v{diagramVersion}): {incidentCount} open incident(s), affected activities: {activities}, {last24hCount} in the last 24h.',
  "c7sum.incidentDetail":
    'Incident {incidentId} ({incidentType}) at activity "{activity}" in "{processDefinitionKey}", instance {processInstanceId}{message}.',
  "c7sum.processDetail":
    'Process "{processDefinitionKey}" (all versions; diagram v{diagramVersion}): {runningInstances} running instance(s), {openIncidents} open incident(s), {failedJobs} job(s) without retries.',
  "c7sum.historyTimeline":
    "History timeline for process instance {processInstanceId}: historic activities: {totalActivities}{notFound}.",
  "c7sum.historyTimeline.notFound": " (no historic process instance found)",
  "c7sum.engineHealth":
    'Engine "{engineId}": {status} ({rule}). Open incidents: {totalIncidents}, affected activities: {affectedActivities}, running instances: {runningInstances}.{topCluster}',
  "c7sum.engineHealth.topCluster":
    ' Top cluster: activity "{activityId}" / {incidentType}, incidents: {incidentCount}.',
  "c7sum.engineHealth.noIncidents": " No open incidents.",
  "c7sum.unknownNumberOf": "an unknown number of",
  "c7sum.atLeast": "at least {count}",
  "c7sum.unknown": "unknown",
  "c7sum.clusterDetail":
    'Failure cluster on engine "{engineId}": activity "{activityId}" / {incidentType}. Incidents: {incidentCount} ({lastHourCount} in the last hour), processes: {processes}.{sample}',
  "c7sum.clusterDetail.unknownProcesses": "unknown processes",
  "c7sum.clusterDetail.sample": " Sample: {message}",
  "c7sum.bpmnViewer": "BPMN diagram for {target}{overlayInfo}{xmlUnavailable}.",
  "c7sum.bpmnViewer.empty":
    "BPMN viewer: no matching process definition found, so the diagram is empty.",
  "c7sum.bpmnViewer.targetInstance": "process instance {processInstanceId}",
  "c7sum.bpmnViewer.targetDefinition": "process definition {definitionId}",
  "c7sum.bpmnViewer.overlays":
    "; running activities: {activeActivities}, activities with incidents: {incidentActivities}, jobs without retries in this instance: {failedJobs}",
  "c7sum.bpmnViewer.noOverlays":
    " (no instance overlays; the badges count all running instances of this version)",
  "c7sum.bpmnViewer.xmlUnavailable": "; diagram XML unavailable",
  "c7sum.jobPanel":
    "Job panel: {totalCount} job(s), {failedCount} without retries{forProcess}{failedOnly}.",
  "c7sum.jobPanel.forProcess": ' for "{processDefinitionKey}"',
  "c7sum.jobPanel.failedOnly": " (only jobs without retries)",
}
