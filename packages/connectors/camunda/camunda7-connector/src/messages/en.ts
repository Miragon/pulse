import type { MessageCatalog } from "@miragon/mcp-toolkit-core"
import { countOf } from "./plural.js"

/** The fallback locale: every key MUST exist here. */
export const en: MessageCatalog = {
  "cockpit.crumb.processList": "All processes",
  "cockpit.section.overview": "Overview",
  "cockpit.section.incidents": "Incidents",
  "cockpit.section.settings": "Settings",
  "cockpit.crumb.overview": "Overview",
  "cockpit.crumb.incidents": "Incidents",
  "cockpit.crumb.instances": "Instances",
  "cockpit.crumb.origin": "Start",
  // The {id} arrives pre-truncated (kit `truncate` appends the ellipsis).
  "cockpit.crumb.instance": ({ id }) => `Instance ${String(id)}`,
  "cockpit.crumb.incident": ({ id }) => `Incident ${String(id)}`,
  "cockpit.crumb.cluster": ({ activity }) => `Cluster: ${String(activity)}`,
  "cockpit.crumb.incidentAt": ({ activity }) => `Incident at ${String(activity)}`,
  "cockpit.loading.engines": "Loading engines…",
  "cockpit.empty.enginesTitle": "No engines configured",
  "cockpit.empty.engines":
    "Ask your administrator to add an engine to the server configuration. Then it shows up here.",
  "cockpit.signature": "Pulse",
  "cockpit.nav.crossEngine": "Cross-engine overview",
  "cockpit.aria.breadcrumb": "Breadcrumb",
  "cockpit.aria.sections": "Cockpit sections",
  "cockpit.aria.activeEngine": "Selected engine",
  "cockpit.refresh": "Refresh",
  "cockpit.refreshing": "Refreshing…",
  "cockpit.landing.title": "Operations Cockpit",
  "cockpit.landing.subtitle": ({ count }) =>
    `${countOf(count, "engine", "engines")} configured. Pick one to work with.`,
  "cockpit.landing.subtitle.env": ({ count, envCount }) =>
    `${countOf(count, "engine", "engines")} in ${countOf(envCount, "environment", "environments")}. Pick one to work with.`,
  "cockpit.landing.envLabel": ({ env }) => `Environment ${String(env).toUpperCase()}`,
  "cockpit.landing.default": "default",
  "cockpit.landing.status.loading": "loading…",
  "cockpit.landing.status.unreachable": "unreachable",
  "cockpit.landing.status.empty": "empty",
  "cockpit.landing.status.incidents": ({ count }) => countOf(count, "incident", "incidents"),
  "cockpit.landing.status.failedJobs": ({ count }) =>
    countOf(count, "job without retries", "jobs without retries"),
  "cockpit.landing.status.idle": "no running instances",
  "cockpit.landing.status.healthy": "no incidents",
  "cockpit.landing.fleet.open": "Cross-engine overview",
  "cockpit.crumb.allEngines": "All engines",
  "cockpit.crumb.fleet": "Cross-engine overview",
  "cockpit.engineGone": ({ engineId }) =>
    `Engine ${String(engineId)} is no longer in your engine list.`,

  "profile.heading": "Engines and dashboards",
  "profile.subtitle": "Which engines you pick from and which dashboards come first, in every chat.",
  "profile.save": "Save",
  "profile.saving": "Saving…",
  "profile.discard": "Discard changes",
  "profile.saveBar.label": "Save settings",
  "profile.saveBar.unsaved": "Your changes to engines or dashboards aren't saved yet.",
  "profile.saveBar.clean": "Engines and dashboards are saved.",
  "profile.saveError": "Could not save the settings. Your input is still here, try again.",
  "profile.readOnly.title": "These settings are read-only here",
  "profile.readOnly.toolset":
    "This connection runs the read-only toolset. With the operations toolset you can change them: ask your administrator to switch the connection.",
  "profile.readOnly.noSignIn":
    "This connection has no sign-in, so it has no one to save settings for. Saving needs a connection with sign-in: ask your administrator to set one up.",
  "profile.loading": "Loading…",
  "profile.none": "No settings available",

  "profile.section.engines": "Engines",
  "profile.section.dashboards": "Dashboards",

  "profile.field.allEngines": "Allow all engines",
  "profile.field.allEngines.help":
    "Every configured engine appears in your pickers, engines added later too. Your permissions stay the same.",
  "profile.field.allowedEngines": "Your engines",
  "profile.field.allowedEngines.help": "Only these engines appear in your pickers.",
  "profile.engines.noneChosen": "Pick at least one engine, or allow all engines.",
  "profile.engines.none": "No engines configured.",
  "profile.field.defaultEngine": "Default engine",
  "profile.field.defaultEngine.help":
    "Tools and the cockpit use this engine when you pick no other.",
  "profile.engine.auto": "(auto)",

  "profile.dashboards.unavailable":
    "Saved dashboards are unavailable. They need a login and a server that allows changes. Ask your administrator to set this up.",
  "profile.dashboards.empty": "No saved dashboards yet. Have the chat build one and save it.",
  "profile.field.defaultDashboard": "Default dashboard",
  "profile.field.defaultDashboard.help": "The AI suggests this dashboard first (load-dashboard).",
  "profile.dashboard.none": "(none)",
  "profile.field.pinnedDashboards": "Pinned dashboards",
  "profile.field.pinnedDashboards.help": "Listed first in dashboard pickers.",

  "profile.summary": ({ engines, defaultDashboard }) =>
    `camunda7 settings: ${String(engines)}${String(defaultDashboard)}.`,
  "profile.summary.allEngines": "all engines",
  "profile.summary.someEngines": ({ count }) => countOf(count, "allowed engine", "allowed engines"),
  "profile.summary.defaultDashboard": ({ id }) =>
    `, default dashboard "${String(id)}" (open via load-dashboard)`,

  // Only used when the profile names a language (`lib/server-locale.ts`).
  "viewTitle.cockpit": "Cockpit",
  "viewTitle.processList": "Process definitions",
  "viewTitle.processInstances": "Running instances",
  "viewTitle.historyTimeline": "History",
  "viewTitle.instanceDetail": "Process instance",
  "viewTitle.bpmnViewer": "BPMN diagram",
  "viewTitle.jobPanel": "Jobs",
  "viewTitle.engineHealth": "Engine overview",
  "viewTitle.settings": "Engines and dashboards",
  "viewTitle.clusterDetail": ({ activity }) => `Cluster: ${String(activity)}`,

  "c7sum.cockpitOpened":
    'Operations cockpit for engine "{engineId}" ({engineCount} engine(s) in the user\'s engine list). Where the host shows the view, the user navigates the process landscape in it.',
  "c7sum.cockpitOpenedPicker":
    "Operations cockpit at its engine picker: {engineCount} engine(s) in the user's engine list, none preselected (no `engine` passed, no saved default). Where the host shows the view, the user picks one there; pass `engine` to open it on a specific engine.",
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
