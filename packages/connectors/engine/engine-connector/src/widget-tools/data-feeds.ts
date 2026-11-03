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
  ENGINE_ACTIVITY_INCIDENTS_DATA,
  ENGINE_BPMN_XML_DATA,
  ENGINE_CLUSTER_DETAIL_DATA,
  ENGINE_COCKPIT_OVERVIEW_DATA,
  ENGINE_HEALTH_DATA,
  ENGINE_HISTORY_TIMELINE_DATA,
  ENGINE_INCIDENT_DETAIL_DATA,
  ENGINE_INCIDENTS_DATA,
  ENGINE_INSTANCE_DETAIL_DATA,
  ENGINE_JOBS_DATA,
  ENGINE_PROCESS_INCIDENTS_DATA,
  ENGINE_PROCESS_INSTANCES_DATA,
} from "../tool-names.js"
import { resolveEngine } from "../lib/resolve-engine.js"
import {
  activityIncidentsFilterShape,
  incidentsDashboardFilterShape,
  instanceSearchShape,
  jobsFilterShape,
  processInstancesFilterShape,
} from "../feed-contracts.js"
import { pagingShape } from "../schemas/index.js"
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
    name: ENGINE_COCKPIT_OVERVIEW_DATA,
    title: "Cockpit overview data (internal)",
    description:
      "Internal JSON feed (no UI) for the cockpit overview: per-definition stats. Prefer engine_open_cockpit.",
    shape: {},
    read: readCockpitOverview,
  })

  registerDataFeed({
    name: ENGINE_HEALTH_DATA,
    title: "Engine health data (internal)",
    description:
      "Internal JSON feed (no UI) for the engine health verdict + incident clusters. Prefer engine_open_cockpit.",
    shape: {},
    read: (_, engine) => readEngineHealth(engine, healthThresholds),
  })

  registerDataFeed({
    name: ENGINE_CLUSTER_DETAIL_DATA,
    title: "Cluster detail data (internal)",
    description:
      "Internal JSON feed (no UI) for one failure cluster's detail. Prefer engine_open_cockpit.",
    shape: clusterDetailShape,
    read: readClusterDetail,
  })

  registerDataFeed({
    name: ENGINE_PROCESS_INSTANCES_DATA,
    title: "Process instances data (internal)",
    description:
      "Internal JSON feed (no UI) for a definition's running instances. Prefer engine_open_cockpit.",
    shape: { ...processInstancesFilterShape, ...instanceSearchShape, ...pagingShape },
    read: readProcessInstances,
  })

  registerDataFeed({
    name: ENGINE_BPMN_XML_DATA,
    title: "BPMN XML data (internal)",
    description:
      "Internal JSON feed (no UI): one deployed process definition's BPMN 2.0 XML, by id, which every diagram in the views draws. Use engine_get_process_definition_xml for the XML itself.",
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
    name: ENGINE_INSTANCE_DETAIL_DATA,
    title: "Instance detail data (internal)",
    description:
      "Internal JSON feed (no UI) for a single process instance. Prefer engine_open_cockpit.",
    shape: { processInstanceId: z.string().describe("The process instance ID") },
    read: readInstanceDetail,
  })

  registerDataFeed({
    name: ENGINE_HISTORY_TIMELINE_DATA,
    title: "History timeline data (internal)",
    description:
      "Internal JSON feed (no UI) for one process instance's activity history, ended instances included. Prefer engine_open_cockpit.",
    shape: { processInstanceId: z.string().describe("The process instance ID") },
    read: readHistoryTimeline,
  })

  registerDataFeed({
    name: ENGINE_JOBS_DATA,
    title: "Jobs data (internal)",
    description: "Internal JSON feed (no UI) for jobs. Prefer engine_open_cockpit.",
    shape: { ...jobsFilterShape, ...pagingShape },
    read: readJobs,
  })

  registerDataFeed({
    name: ENGINE_INCIDENTS_DATA,
    title: "Incidents dashboard data (internal)",
    description:
      "Internal JSON feed (no UI) for the incidents dashboard: open incidents grouped by process. Prefer engine_open_cockpit.",
    shape: incidentsDashboardFilterShape,
    read: readIncidents,
  })

  registerDataFeed({
    name: ENGINE_PROCESS_INCIDENTS_DATA,
    title: "Process incidents data (internal)",
    description:
      "Internal JSON feed (no UI) for the unified definition view: header, KPIs (incl. failed jobs), BPMN overlays, activity-grouped incidents. Prefer engine_open_cockpit.",
    shape: { processDefinitionKey: z.string().describe("Process definition key to drill into") },
    read: readProcessIncidents,
  })

  registerDataFeed({
    name: ENGINE_ACTIVITY_INCIDENTS_DATA,
    title: "Activity incidents data (internal)",
    description:
      "Internal JSON feed (no UI) for one activity's incident rows, offset-paged. Prefer engine_open_cockpit.",
    shape: { ...activityIncidentsFilterShape, ...pagingShape },
    read: async (filters, { client, engineId, ...urls }) => ({
      ...(await buildActivityIncidentsData(client, { ...urls, ...filters })),
      engineId,
    }),
  })

  registerDataFeed({
    name: ENGINE_INCIDENT_DETAIL_DATA,
    title: "Incident detail data (internal)",
    description:
      "Internal JSON feed (no UI) for a single incident: stacktrace, BPMN with the failing activity, variables, activity tree, history. Prefer engine_open_cockpit.",
    shape: { incidentId: z.string().describe("The incident ID to inspect") },
    read: readIncidentDetail,
  })
}
