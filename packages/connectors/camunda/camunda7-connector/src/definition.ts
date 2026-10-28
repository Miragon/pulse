import { z } from "zod"
import type { AppDefinition } from "@miragon/mcp-toolkit-core"
import {
  loadProcessDefinitionsStep,
  loadProcessInstanceStep,
  loadIncidentsDashboardStep,
  loadProcessIncidentsStep,
  loadHistoryTimelineStep,
  loadCockpitDashboardStep,
  loadBpmnViewerStep,
  loadJobsStep,
} from "./steps/index.js"
import { processInstancesFilterShape } from "./feed-contracts.js"
import { builderAppTitle, builderText, fieldText } from "./builder-texts.js"

/**
 * The `engine` a composed widget reads from (#344 N115): render-view and the
 * builder can pin a view to an engine, as the cockpit does through its props.
 */
const engineField = (widget: string) =>
  z
    .string()
    .optional()
    .describe("Engine id. Omitted → saved default engine or single default.")
    .meta(fieldText(`${widget}.engine`))

const processListPropsSchema = z.toJSONSchema(
  z.object({
    engine: engineField("processList"),
    processDefinitionKey: z
      .string()
      .optional()
      .describe("Filter to an exact process definition key.")
      .meta(fieldText("processList.processDefinitionKey")),
    nameLike: z
      .string()
      .optional()
      .describe("Filter by partial process definition name.")
      .meta(fieldText("processList.nameLike")),
    latestVersion: z
      .boolean()
      .optional()
      .describe("Restrict to the latest version of each definition (default `true`).")
      .meta(fieldText("processList.latestVersion")),
  }),
)

const bpmnViewerPropsSchema = z.toJSONSchema(
  z.object({
    processInstanceId: z
      .string()
      .optional()
      .describe(
        "Render the diagram with the running instance's OWN overlays: its active activities, incidents, tokens and failed jobs.",
      )
      .meta(fieldText("bpmnViewer.processInstanceId")),
    processDefinitionKey: z
      .string()
      .optional()
      .describe(
        "Render the diagram of a process definition version; its badges count every running instance of that version. Combine with `version` to pin a specific revision.",
      )
      .meta(fieldText("bpmnViewer.processDefinitionKey")),
    version: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Specific definition version. Requires `processDefinitionKey`. Defaults to latest.")
      .meta(fieldText("bpmnViewer.version")),
    engine: z
      .string()
      .optional()
      .describe("Engine id. Omitted → saved default engine or single default.")
      .meta(fieldText("bpmnViewer.engine")),
  }),
)

const activityIncidentListPropsSchema = z.toJSONSchema(
  z.object({
    emptyVariant: z
      .enum(["siblings", "note"])
      .optional()
      .describe(
        'No-incidents rendering: "note" (slim success note, default) or "siblings" (offer other processes with open incidents).',
      )
      .meta(fieldText("activityIncidentList.emptyVariant")),
  }),
)

const processInstancesPropsSchema = z.toJSONSchema(
  z.object({
    engine: engineField("processInstances"),
    processDefinitionKey: z
      .string()
      .describe("Process definition key whose instances to list.")
      .meta(fieldText("processInstances.processDefinitionKey")),
    active: processInstancesFilterShape.active.meta(fieldText("processInstances.active")),
    suspended: processInstancesFilterShape.suspended.meta(fieldText("processInstances.suspended")),
    withIncidents: processInstancesFilterShape.withIncidents.meta(
      fieldText("processInstances.withIncidents"),
    ),
    businessKeyLike: processInstancesFilterShape.businessKeyLike.meta(
      fieldText("processInstances.businessKeyLike"),
    ),
  }),
)

const incidentDetailPropsSchema = z.toJSONSchema(
  z.object({
    engine: engineField("incidentDetail"),
    incidentId: z
      .string()
      .describe("The incident ID to inspect.")
      .meta(fieldText("incidentDetail.incidentId")),
  }),
)

const engineHealthPropsSchema = z.toJSONSchema(
  z.object({
    engine: z
      .string()
      .optional()
      .describe(
        "Engine id to assess. Omitted → the caller's saved default engine or the single configured engine.",
      )
      .meta(fieldText("engineHealth.engine")),
  }),
)

const clusterDetailPropsSchema = z.toJSONSchema(
  z.object({
    activityId: z
      .string()
      .describe("Activity id of the failure cluster.")
      .meta(fieldText("clusterDetail.activityId")),
    incidentType: z
      .string()
      .describe('Incident type of the cluster, e.g. "failedJob".')
      .meta(fieldText("clusterDetail.incidentType")),
    messageSignature: z
      .string()
      .optional()
      .describe("Normalized failure-message signature from the overview cluster (optional filter).")
      .meta(fieldText("clusterDetail.messageSignature")),
    engine: z
      .string()
      .optional()
      .describe("Engine id. Omitted → saved default engine or single default.")
      .meta(fieldText("clusterDetail.engine")),
  }),
)

export const definition: AppDefinition = {
  name: "camunda7",
  // The view builder's names for people (en + de); `description` is the model's text.
  title: builderAppTitle(),
  steps: [
    loadProcessDefinitionsStep,
    loadProcessInstanceStep,
    loadIncidentsDashboardStep,
    loadProcessIncidentsStep,
    loadHistoryTimelineStep,
    loadCockpitDashboardStep,
    loadBpmnViewerStep,
    loadJobsStep,
  ],
  widgets: [
    {
      id: "camunda7:process-list",
      ...builderText("widget.process-list"),
      description:
        "Deployed process definitions (latest version of each by default) with search and the exact total.",
      consumes: ["camunda7:processDefinitionList"],
      requires: [],
      size: "full",
      propsSchema: processListPropsSchema,
    },
    {
      id: "camunda7:instance-detail",
      ...builderText("widget.instance-detail"),
      description:
        "One running process instance: state, open user tasks and incidents (exact totals), variables, history, diagram.",
      consumes: ["camunda7:processInstance"],
      requires: ["camunda7:instance"],
      size: "full",
    },
    {
      id: "camunda7:incident-overview-kpi",
      ...builderText("widget.incident-overview-kpi"),
      description:
        "Open-incident KPIs across all definitions: exact total, affected processes, last 24h.",
      consumes: ["camunda7:incidentsDashboard"],
      requires: ["camunda7:incidentsDashboardData"],
      size: "full",
    },
    {
      id: "camunda7:incident-process-list",
      ...builderText("widget.incident-process-list"),
      description:
        "Open incidents per definition key (all versions, exact counts); each card's activity breakdown covers its newest incidents.",
      consumes: ["camunda7:incidentsDashboard"],
      requires: ["camunda7:incidentsDashboardData"],
      size: "full",
    },
    {
      id: "camunda7:process-detail-header",
      ...builderText("widget.process-detail-header"),
      description:
        "Header of the definition view of one key (all versions): running instances, latest incident, AI analysis.",
      consumes: ["camunda7:processIncidents"],
      requires: ["camunda7:processIncidentsData"],
      size: "full",
    },
    {
      id: "camunda7:process-definition-kpi",
      ...builderText("widget.process-definition-kpi"),
      description:
        "KPI strip of one definition key over all its versions: running instances, open incidents, last 24h, failed jobs.",
      consumes: ["camunda7:processIncidents"],
      requires: ["camunda7:processIncidentsData"],
      size: "full",
    },
    {
      id: "camunda7:process-definition-flow",
      ...builderText("widget.process-definition-flow"),
      description:
        "The key's latest diagram, leading with incident overlays summed over all versions; the execution heatmap modes join once analytics is active.",
      consumes: ["camunda7:processIncidents"],
      requires: ["camunda7:processIncidentsData"],
      size: "full",
    },
    {
      id: "camunda7:activity-incident-list",
      ...builderText("widget.activity-incident-list"),
      description:
        "One key's open incidents grouped by activity (exact counts over all versions); each group pages its incidents.",
      consumes: ["camunda7:processIncidents"],
      requires: ["camunda7:processIncidentsData"],
      size: "full",
      propsSchema: activityIncidentListPropsSchema,
    },
    {
      // Self-fetching (no pipeline step).
      id: "camunda7:incident-detail",
      ...builderText("widget.incident-detail"),
      description:
        "One incident: failure and stacktrace, its instance's state and variables, the diagram, and the recovery it allows.",
      requires: [],
      size: "full",
      propsSchema: incidentDetailPropsSchema,
    },
    {
      id: "camunda7:history-timeline",
      ...builderText("widget.history-timeline"),
      description:
        "The activity history of one process instance as a timeline (paged, exact total).",
      consumes: ["camunda7:historyTimeline"],
      requires: ["camunda7:historyProcessInstance", "camunda7:historyActivities"],
      size: "full",
    },
    {
      // Self-fetching (no pipeline step).
      id: "camunda7:engine-health",
      ...builderText("widget.engine-health"),
      description:
        "The engine verdict from its open incidents (rule stated), exact totals and the top failure clusters.",
      requires: [],
      size: "full",
      propsSchema: engineHealthPropsSchema,
    },
    {
      // Self-fetching (no pipeline step).
      id: "camunda7:cluster-detail",
      ...builderText("widget.cluster-detail"),
      description:
        "One failure cluster (activity, incident type, message): its KPIs and the affected instances.",
      requires: [],
      size: "full",
      propsSchema: clusterDetailPropsSchema,
    },
    {
      id: "camunda7:process-health-kpi",
      ...builderText("widget.process-health-kpi"),
      description:
        "Landscape KPIs over all definition keys: definitions in total, healthy, affected (open incidents or failed jobs), open incidents.",
      consumes: ["camunda7:cockpitDashboard"],
      requires: ["camunda7:cockpitDashboardData"],
      size: "full",
    },
    {
      id: "camunda7:process-definitions-table",
      ...builderText("widget.process-definitions-table"),
      description:
        "One row per definition key: running instances, failed jobs and incidents summed over all versions.",
      consumes: ["camunda7:cockpitDashboard"],
      requires: ["camunda7:cockpitDashboardData"],
      size: "full",
    },
    {
      // Self-fetching (no pipeline step).
      id: "camunda7:process-instances",
      ...builderText("widget.process-instances"),
      description:
        "Running process instances (filterable, paged) with exact totals and per-row incident flags.",
      requires: [],
      size: "full",
      propsSchema: processInstancesPropsSchema,
    },
    {
      id: "camunda7:bpmn-viewer",
      ...builderText("widget.bpmn-viewer"),
      description:
        "A BPMN diagram: a running instance with its own tokens, incidents and failed jobs, or a definition version.",
      consumes: ["camunda7:bpmnViewer"],
      requires: [],
      size: "full",
      propsSchema: bpmnViewerPropsSchema,
    },
    {
      id: "camunda7:bpmn-viewer-header",
      ...builderText("widget.bpmn-viewer-header"),
      description:
        "Header of the BPMN viewer: the instance, its active and incident activity counts, AI analysis.",
      consumes: ["camunda7:bpmnViewer"],
      requires: ["camunda7:bpmnViewerData"],
      size: "full",
    },
    {
      id: "camunda7:bpmn-viewer-legend",
      ...builderText("widget.bpmn-viewer-legend"),
      description: "Legend of the BPMN viewer's overlays, naming whose counts the badges show.",
      consumes: ["camunda7:bpmnViewer"],
      requires: ["camunda7:bpmnViewerData"],
      size: "full",
    },
    {
      id: "camunda7:bpmn-flow-viewer",
      ...builderText("widget.bpmn-flow-viewer"),
      description: "The BPMN viewer's canvas with token, incident and failed-job overlays.",
      consumes: ["camunda7:bpmnViewer"],
      requires: ["camunda7:bpmnViewerData"],
      size: "full",
    },
    {
      id: "camunda7:job-panel",
      ...builderText("widget.job-panel"),
      description: "Jobs (paged) with the exact totals of all and of failed jobs.",
      consumes: ["camunda7:jobPanel"],
      requires: ["camunda7:jobPanelData"],
      size: "full",
    },
    {
      // Self-fetching (no pipeline step).
      id: "camunda7:settings",
      ...builderText("widget.settings"),
      description:
        "The signed-in user's camunda7 settings (available engines, default engine, dashboards) — opened by camunda7_show_settings.",
      requires: [],
      size: "full",
    },
    {
      id: "camunda7:cockpit-app",
      ...builderText("widget.cockpit-app"),
      description:
        "The whole navigable cockpit — opened by camunda7_open_cockpit, not composed into a view.",
      requires: [],
      size: "full",
    },
  ],
}
