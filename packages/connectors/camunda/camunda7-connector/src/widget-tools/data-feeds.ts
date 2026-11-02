import { z } from "zod"
import {
  appOnly,
  buildDataFeedResult,
  withToolErrors,
  strictToolInput,
} from "@miragon/pulse-widget-shell/server"
import { buildActivityIncidentsData } from "../data/process-incidents-data.js"
import {
  readClusterDetail,
  readCockpitOverview,
  readEngineHealth,
  readHistoryTimeline,
  readIncidentDetail,
  readIncidents,
  readInstanceDetail,
  readJobs,
  readProcessIncidents,
  readProcessInstances,
} from "../data/route-reads.js"
import { fetchDefinitionXml } from "../data/definition-info.js"
import {
  CAMUNDA7_ACTIVITY_INCIDENTS_DATA,
  CAMUNDA7_BPMN_XML_DATA,
  CAMUNDA7_CLUSTER_DETAIL_DATA,
  CAMUNDA7_COCKPIT_OVERVIEW_DATA,
  CAMUNDA7_ENGINE_HEALTH_DATA,
  CAMUNDA7_HISTORY_TIMELINE_DATA,
  CAMUNDA7_INCIDENT_DETAIL_DATA,
  CAMUNDA7_INCIDENTS_DATA,
  CAMUNDA7_INSTANCE_DETAIL_DATA,
  CAMUNDA7_JOBS_DATA,
  CAMUNDA7_PROCESS_INCIDENTS_DATA,
  CAMUNDA7_PROCESS_INSTANCES_DATA,
} from "../tool-names.js"
import { resolveEngine } from "../lib/resolve-engine.js"
import {
  activityIncidentsFilterShape,
  incidentsDashboardFilterShape,
  instanceSearchShape,
  jobsFilterShape,
  pagingShape,
  processInstancesFilterShape,
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
        const resolved = resolveEngine(engine, registry, ctx)
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
    read: readCockpitOverview,
  })

  registerDataFeed({
    name: CAMUNDA7_ENGINE_HEALTH_DATA,
    title: "Engine health data (internal)",
    description:
      "Internal JSON feed (no UI) for the engine health verdict + incident clusters. Prefer camunda7_open_cockpit.",
    shape: {},
    read: (_, engine) => readEngineHealth(engine, healthThresholds),
  })

  registerDataFeed({
    name: CAMUNDA7_CLUSTER_DETAIL_DATA,
    title: "Cluster detail data (internal)",
    description:
      "Internal JSON feed (no UI) for one failure cluster's detail. Prefer camunda7_open_cockpit.",
    shape: clusterDetailShape,
    read: readClusterDetail,
  })

  registerDataFeed({
    name: CAMUNDA7_PROCESS_INSTANCES_DATA,
    title: "Process instances data (internal)",
    description:
      "Internal JSON feed (no UI) for a definition's running instances. Prefer camunda7_open_cockpit.",
    shape: { ...processInstancesFilterShape, ...instanceSearchShape, ...pagingShape },
    read: readProcessInstances,
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
    name: CAMUNDA7_INSTANCE_DETAIL_DATA,
    title: "Instance detail data (internal)",
    description:
      "Internal JSON feed (no UI) for a single process instance. Prefer camunda7_open_cockpit.",
    shape: { processInstanceId: z.string().describe("The process instance ID") },
    read: readInstanceDetail,
  })

  registerDataFeed({
    name: CAMUNDA7_HISTORY_TIMELINE_DATA,
    title: "History timeline data (internal)",
    description:
      "Internal JSON feed (no UI) for one process instance's activity history, ended instances included. Prefer camunda7_open_cockpit.",
    shape: { processInstanceId: z.string().describe("The process instance ID") },
    read: readHistoryTimeline,
  })

  registerDataFeed({
    name: CAMUNDA7_JOBS_DATA,
    title: "Jobs data (internal)",
    description: "Internal JSON feed (no UI) for jobs. Prefer camunda7_open_cockpit.",
    shape: { ...jobsFilterShape, ...pagingShape },
    read: readJobs,
  })

  registerDataFeed({
    name: CAMUNDA7_INCIDENTS_DATA,
    title: "Incidents dashboard data (internal)",
    description:
      "Internal JSON feed (no UI) for the incidents dashboard — open incidents grouped by process. Prefer camunda7_open_cockpit.",
    shape: incidentsDashboardFilterShape,
    read: readIncidents,
  })

  registerDataFeed({
    name: CAMUNDA7_PROCESS_INCIDENTS_DATA,
    title: "Process incidents data (internal)",
    description:
      "Internal JSON feed (no UI) for the unified definition view — header, KPIs (incl. failed jobs), BPMN overlays, activity-grouped incidents. Prefer camunda7_open_cockpit.",
    shape: { processDefinitionKey: z.string().describe("Process definition key to drill into") },
    read: readProcessIncidents,
  })

  registerDataFeed({
    name: CAMUNDA7_ACTIVITY_INCIDENTS_DATA,
    title: "Activity incidents data (internal)",
    description:
      "Internal JSON feed (no UI) for one activity's incident rows, offset-paged. Prefer camunda7_open_cockpit.",
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
      "Internal JSON feed (no UI) for a single incident — stacktrace, BPMN with the failing activity, variables, activity tree, history. Prefer camunda7_open_cockpit.",
    shape: { incidentId: z.string().describe("The incident ID to inspect") },
    read: readIncidentDetail,
  })
}
