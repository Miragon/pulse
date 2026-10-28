import { z } from "zod"
import {
  appOnly,
  buildDataFeedResult,
  withToolErrors,
  strictToolInput,
} from "@miragon/pulse-widget-shell/server"
import {
  buildCockpitDashboardData,
  buildJobPanelData,
  buildProcessInstancesData,
  buildProcessListData,
} from "../data/cockpit-data.js"
import { buildInstanceDetailData } from "../data/instance-detail-data.js"
import { buildClusterDetailData } from "../data/cluster-detail-data.js"
import { buildEngineHealthData } from "../data/health-data.js"
import { buildIncidentsDashboardData } from "../data/incidents-dashboard-data.js"
import {
  buildActivityIncidentsData,
  buildProcessIncidentsData,
} from "../data/process-incidents-data.js"
import { buildIncidentDetailData } from "../data/incident-detail-data.js"
import { buildBpmnViewerData } from "../data/bpmn-viewer-data.js"
import { fetchDefinitionXml } from "../data/definition-info.js"
import {
  CAMUNDA7_ACTIVITY_INCIDENTS_DATA,
  CAMUNDA7_BPMN_VIEWER_DATA,
  CAMUNDA7_BPMN_XML_DATA,
  CAMUNDA7_CLUSTER_DETAIL_DATA,
  CAMUNDA7_COCKPIT_OVERVIEW_DATA,
  CAMUNDA7_ENGINE_HEALTH_DATA,
  CAMUNDA7_INCIDENT_DETAIL_DATA,
  CAMUNDA7_INCIDENTS_DATA,
  CAMUNDA7_INSTANCE_DETAIL_DATA,
  CAMUNDA7_JOBS_DATA,
  CAMUNDA7_PROCESS_INCIDENTS_DATA,
  CAMUNDA7_PROCESS_INSTANCES_DATA,
  CAMUNDA7_PROCESS_LIST_DATA,
} from "../tool-names.js"
import { resolveEngine } from "../lib/resolve-engine.js"
import {
  activityIncidentsFilterShape,
  incidentsDashboardFilterShape,
  instanceSearchShape,
  jobsFilterShape,
  pagingShape,
  processInstancesFilterShape,
  processListFilterShape,
} from "../feed-contracts.js"
import { type WidgetToolsContext, type ResolvedEngine, clusterDetailShape } from "./shared.js"

type FeedInput<TShape extends z.ZodRawShape> = z.output<z.ZodObject<TShape>>

interface DataFeed<TShape extends z.ZodRawShape> {
  name: string
  title: string
  description: string
  shape: TShape
  read: (input: FeedInput<TShape>, engine: ResolvedEngine) => Promise<object>
}

export function registerWidgetDataFeeds(ctx: WidgetToolsContext) {
  const { server, registry, healthThresholds, engineParam } = ctx

  function registerDataFeed<TShape extends z.ZodRawShape>(feed: DataFeed<TShape>) {
    server.tool(
      {
        name: feed.name,
        title: feed.title,
        description: feed.description,
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
        inputSchema: strictToolInput({ ...feed.shape, ...engineParam }),
        ...appOnly,
      },
      withToolErrors(async (args, ctx) => {
        const { engine, ...input } = args as { engine?: string }
        const resolved = await resolveEngine(engine, registry, ctx)
        const data = await feed.read(input as FeedInput<TShape>, resolved)
        return buildDataFeedResult({ ...data })
      }),
    )
  }

  registerDataFeed({
    name: CAMUNDA7_COCKPIT_OVERVIEW_DATA,
    title: "Cockpit overview data (internal)",
    description:
      "Internal JSON feed (no UI) for the cockpit overview — per-definition stats. Prefer camunda7_open_cockpit.",
    shape: {},
    read: (_, { client, engineId }) => buildCockpitDashboardData(client, engineId),
  })

  registerDataFeed({
    name: CAMUNDA7_ENGINE_HEALTH_DATA,
    title: "Engine health data (internal)",
    description:
      "Internal JSON feed (no UI) for the engine health verdict + incident clusters. Prefer camunda7_show_engine_health / camunda7_open_cockpit.",
    shape: {},
    read: (_, { client, engineId }) => buildEngineHealthData(client, engineId, healthThresholds),
  })

  registerDataFeed({
    name: CAMUNDA7_CLUSTER_DETAIL_DATA,
    title: "Cluster detail data (internal)",
    description:
      "Internal JSON feed (no UI) for one failure cluster's detail. Prefer camunda7_show_cluster_detail.",
    shape: clusterDetailShape,
    read: (cluster, { client, engineId }) => buildClusterDetailData(client, engineId, cluster),
  })

  registerDataFeed({
    name: CAMUNDA7_PROCESS_INSTANCES_DATA,
    title: "Process instances data (internal)",
    description:
      "Internal JSON feed (no UI) for a definition's running instances. Prefer camunda7_show_process_instances.",
    shape: { ...processInstancesFilterShape, ...instanceSearchShape, ...pagingShape },
    read: (filters, { client, engineId }) => buildProcessInstancesData(client, engineId, filters),
  })

  registerDataFeed({
    name: CAMUNDA7_BPMN_VIEWER_DATA,
    title: "BPMN viewer data (internal)",
    description:
      "Internal JSON feed (no UI) for the BPMN viewer — diagram XML plus live overlays. Prefer camunda7_show_bpmn_viewer.",
    shape: {
      processInstanceId: z.string().optional().describe("Instance to overlay live state for."),
      processDefinitionKey: z.string().optional().describe("Definition for a version's diagram."),
      version: z.number().int().positive().optional(),
    },
    read: (target, { client, engineId }) => buildBpmnViewerData(client, engineId, target),
  })

  registerDataFeed({
    name: CAMUNDA7_BPMN_XML_DATA,
    title: "BPMN XML data (internal)",
    description:
      "Internal JSON feed (no UI): one deployed process definition's BPMN 2.0 XML, by id — what every diagram in the views draws. Use camunda7_get_process_definition_xml for the XML itself.",
    shape: {
      processDefinitionId: z
        .string()
        .min(1)
        .describe("The deployed version's id (key:version:deployment)."),
    },
    read: async ({ processDefinitionId }, { client }) => ({
      processDefinitionId,
      bpmnXml: await fetchDefinitionXml(client, processDefinitionId),
    }),
  })

  registerDataFeed({
    name: CAMUNDA7_PROCESS_LIST_DATA,
    title: "Process list data (internal)",
    description:
      "Internal JSON feed (no UI) for deployed process definitions, offset-paged. Prefer camunda7_show_process_list.",
    shape: { ...processListFilterShape, ...pagingShape },
    read: (filters, { client, engineId }) => buildProcessListData(client, engineId, filters),
  })

  registerDataFeed({
    name: CAMUNDA7_INSTANCE_DETAIL_DATA,
    title: "Instance detail data (internal)",
    description:
      "Internal JSON feed (no UI) for a single process instance. Prefer camunda7_show_instance_detail.",
    shape: { processInstanceId: z.string().describe("The process instance ID") },
    read: (target, { client, engineId, ...urls }) =>
      buildInstanceDetailData(client, engineId, target, urls),
  })

  registerDataFeed({
    name: CAMUNDA7_JOBS_DATA,
    title: "Jobs data (internal)",
    description: "Internal JSON feed (no UI) for jobs. Prefer camunda7_show_job_panel.",
    shape: { ...jobsFilterShape, ...pagingShape },
    read: (filters, { client, engineId }) => buildJobPanelData(client, engineId, filters),
  })

  registerDataFeed({
    name: CAMUNDA7_INCIDENTS_DATA,
    title: "Incidents dashboard data (internal)",
    description:
      "Internal JSON feed (no UI) for the incidents dashboard — open incidents grouped by process. Prefer camunda7_show_incidents_dashboard.",
    shape: incidentsDashboardFilterShape,
    read: async (filters, { client, engineId, ...urls }) => ({
      ...(await buildIncidentsDashboardData(client, { ...urls, ...filters })),
      engineId,
    }),
  })

  registerDataFeed({
    name: CAMUNDA7_PROCESS_INCIDENTS_DATA,
    title: "Process incidents data (internal)",
    description:
      "Internal JSON feed (no UI) for the unified definition view — header, KPIs (incl. failed jobs), BPMN overlays, activity-grouped incidents. Prefer camunda7_show_process_detail / camunda7_show_process_incidents.",
    shape: { processDefinitionKey: z.string().describe("Process definition key to drill into") },
    read: async (target, { client, engineId, ...urls }) => ({
      ...(await buildProcessIncidentsData(client, { ...urls, ...target })),
      engineId,
    }),
  })

  registerDataFeed({
    name: CAMUNDA7_ACTIVITY_INCIDENTS_DATA,
    title: "Activity incidents data (internal)",
    description:
      "Internal JSON feed (no UI) for one activity's incident rows, offset-paged. Prefer camunda7_show_process_incidents.",
    shape: { ...activityIncidentsFilterShape, ...pagingShape },
    read: async (filters, { client, engineId, ...urls }) => ({
      ...(await buildActivityIncidentsData(client, { ...urls, ...filters })),
      engineId,
    }),
  })

  registerDataFeed({
    name: CAMUNDA7_INCIDENT_DETAIL_DATA,
    title: "Incident detail data (internal)",
    description:
      "Internal JSON feed (no UI) for a single incident — stacktrace, BPMN with the failing activity, variables, activity tree, history. Prefer camunda7_show_incident_detail.",
    shape: { incidentId: z.string().describe("The incident ID to inspect") },
    read: async (target, { client, engineId, ...urls }) => ({
      ...(await buildIncidentDetailData(client, { ...urls, ...target })),
      engineId,
    }),
  })
}
