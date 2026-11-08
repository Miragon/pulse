import { z } from "zod"
import {
  activityIncidentsFilterShape,
  activityStatisticsShape,
  clusterDetailFilterShape,
  incidentsDashboardFilterShape,
  instanceSearchShape,
  jobsFilterShape,
  processInstancesFilterShape,
} from "../feed-contracts.js"
import type { ResolvedEngine } from "../lib/engine/resolve-engine.js"
import { pagingShape } from "../schemas/index.js"
import {
  ENGINE_ACTIVITY_INCIDENTS_DATA,
  ENGINE_ACTIVITY_STATISTICS_DATA,
  ENGINE_BPMN_XML_DATA,
  ENGINE_CLUSTER_DETAIL_DATA,
  ENGINE_COCKPIT_OVERVIEW_DATA,
  ENGINE_HEALTH_DATA,
  ENGINE_HISTORY_TIMELINE_DATA,
  ENGINE_INCIDENT_DETAIL_DATA,
  ENGINE_INCIDENTS_DATA,
  ENGINE_INSTANCE_DETAIL_DATA,
  ENGINE_JOB_BACKLOG_DATA,
  ENGINE_JOBS_DATA,
  ENGINE_PROCESS_INCIDENTS_DATA,
  ENGINE_PROCESS_INSTANCES_DATA,
} from "../tool-names.js"
import { HISTORY_PAGE_SIZE } from "../view-models.js"
import { buildActivityStatisticsData } from "./activity-statistics-data.js"
import { buildClusterDetailData } from "./cluster-detail-data.js"
import {
  buildCockpitDashboardData,
  buildJobPanelData,
  buildProcessInstancesData,
} from "./cockpit-data.js"
import { fetchDefinitionXml } from "./definition-info.js"
import type { VerdictThresholds } from "@miragon/pulse-engine-core"
import { buildEngineHealthData } from "./health-data.js"
import { buildHistoryTimelineData } from "./history-timeline-data.js"
import { buildIncidentDetailData } from "./incident-detail-data.js"
import { buildIncidentsDashboardData } from "./incidents-dashboard-data.js"
import { buildInstanceDetailData } from "./instance-detail-data.js"
import { buildJobBacklogData } from "./job-backlog-data.js"
import { buildActivityIncidentsData, buildProcessIncidentsData } from "./process-incidents-data.js"

/**
 * The cockpit's `*_data` feeds, described once: name, title, the description the model reads,
 * input shape and read. Every engine read of a route lives in its feed here;
 * `widget-tools/data-feeds.ts` registers `DATA_FEEDS`, and a route of `routes.ts` starts from
 * its feed's read, so the start view's data is the feed's payload by construction.
 */

type FeedInput<TShape extends z.ZodRawShape> = z.output<z.ZodObject<TShape>>

/** What a read needs besides its engine: the deployment's health thresholds. */
export interface ReadContext {
  healthThresholds: VerdictThresholds
}

/** An app-only JSON feed: the widget's refresh, paging and navigation. */
export interface DataFeed<TShape extends z.ZodRawShape = z.ZodRawShape, TData = object> {
  name: string
  title: string
  description: string
  shape: TShape
  // A method, so a feed of any shape fits the list of every feed.
  read(input: FeedInput<TShape>, engine: ResolvedEngine, ctx: ReadContext): Promise<TData>
}

const dataFeed = <TShape extends z.ZodRawShape, TData extends object>(
  feed: DataFeed<TShape, TData>,
) => feed

export const overviewFeed = dataFeed({
  name: ENGINE_COCKPIT_OVERVIEW_DATA,
  title: "Cockpit overview data (internal)",
  description:
    "Internal JSON feed (no UI) for the cockpit overview: per-definition stats. Prefer engine_open_cockpit.",
  shape: {},
  read: (_, { client, engineId }) => buildCockpitDashboardData(client, engineId),
})

export const healthFeed = dataFeed({
  name: ENGINE_HEALTH_DATA,
  title: "Engine health data (internal)",
  description:
    "Internal JSON feed (no UI) for the engine health verdict + incident clusters. Prefer engine_open_cockpit.",
  shape: {},
  read: (_, { client, engineId }, { healthThresholds }) =>
    buildEngineHealthData(client, engineId, healthThresholds),
})

export const clusterDetailFeed = dataFeed({
  name: ENGINE_CLUSTER_DETAIL_DATA,
  title: "Cluster detail data (internal)",
  description:
    "Internal JSON feed (no UI) for one failure cluster's detail. Prefer engine_open_cockpit.",
  shape: { ...clusterDetailFilterShape, ...pagingShape },
  read: (args, { client, engineId }) => buildClusterDetailData(client, engineId, args),
})

export const processInstancesFeed = dataFeed({
  name: ENGINE_PROCESS_INSTANCES_DATA,
  title: "Process instances data (internal)",
  description:
    "Internal JSON feed (no UI) for a definition's running instances. Prefer engine_open_cockpit.",
  shape: { ...processInstancesFilterShape, ...instanceSearchShape, ...pagingShape },
  read: (args, { client, engineId }) => buildProcessInstancesData(client, engineId, args),
})

const bpmnXmlFeed = dataFeed({
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

export const instanceDetailFeed = dataFeed({
  name: ENGINE_INSTANCE_DETAIL_DATA,
  title: "Instance detail data (internal)",
  description:
    "Internal JSON feed (no UI) for a single process instance. Prefer engine_open_cockpit.",
  shape: { processInstanceId: z.string().describe("The process instance ID") },
  read: (target, { client, engineId, ...urls }) =>
    buildInstanceDetailData(client, engineId, target, urls),
})

export const historyTimelineFeed = dataFeed({
  name: ENGINE_HISTORY_TIMELINE_DATA,
  title: "History timeline data (internal)",
  description:
    "Internal JSON feed (no UI) for one process instance's activity history, ended instances included. Prefer engine_open_cockpit.",
  shape: { processInstanceId: z.string().describe("The process instance ID") },
  read: ({ processInstanceId }, { client, engineId }) =>
    buildHistoryTimelineData(client, engineId, {
      processInstanceId,
      maxResults: HISTORY_PAGE_SIZE,
    }),
})

export const jobsFeed = dataFeed({
  name: ENGINE_JOBS_DATA,
  title: "Jobs data (internal)",
  description: "Internal JSON feed (no UI) for jobs. Prefer engine_open_cockpit.",
  shape: { ...jobsFilterShape, ...pagingShape },
  read: (args, { client, engineId }) => buildJobPanelData(client, engineId, args),
})

// The feeds below add `engineId` to their builder's result.

const jobBacklogFeed = dataFeed({
  name: ENGINE_JOB_BACKLOG_DATA,
  title: "Job backlog data (internal)",
  description:
    "Internal JSON feed (no UI) for the cross-engine overview: one engine's executable, suspended and later-due jobs and its external tasks. Prefer engine_open_cockpit.",
  shape: {},
  read: async (_, { client, engineId }) => ({
    ...(await buildJobBacklogData(client)),
    engineId,
  }),
})

export const incidentsFeed = dataFeed({
  name: ENGINE_INCIDENTS_DATA,
  title: "Incidents dashboard data (internal)",
  description:
    "Internal JSON feed (no UI) for the incidents dashboard: open incidents grouped by process. Prefer engine_open_cockpit.",
  shape: incidentsDashboardFilterShape,
  read: async (filters, { client, engineId, ...urls }) => ({
    ...(await buildIncidentsDashboardData(client, { ...urls, ...filters })),
    engineId,
  }),
})

export const processIncidentsFeed = dataFeed({
  name: ENGINE_PROCESS_INCIDENTS_DATA,
  title: "Process incidents data (internal)",
  description:
    "Internal JSON feed (no UI) for the unified definition view: header, KPIs (incl. failed jobs), BPMN overlays, activity-grouped incidents. Prefer engine_open_cockpit.",
  shape: { processDefinitionKey: z.string().describe("Process definition key to drill into") },
  read: async (target, { client, engineId, ...urls }) => ({
    ...(await buildProcessIncidentsData(client, { ...urls, ...target })),
    engineId,
  }),
})

const activityIncidentsFeed = dataFeed({
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

const activityStatisticsFeed = dataFeed({
  name: ENGINE_ACTIVITY_STATISTICS_DATA,
  title: "Activity statistics data (internal)",
  description:
    "Internal JSON feed (no UI) for the process flow: what runs at each element of a process now, over every deployed version. Prefer engine_open_cockpit.",
  shape: activityStatisticsShape,
  read: async (args, { client, engineId }) => ({
    ...(await buildActivityStatisticsData(client, args)),
    engineId,
  }),
})

export const incidentDetailFeed = dataFeed({
  name: ENGINE_INCIDENT_DETAIL_DATA,
  title: "Incident detail data (internal)",
  description:
    "Internal JSON feed (no UI) for a single incident: stacktrace, BPMN with the failing activity, variables, activity tree, history. Prefer engine_open_cockpit.",
  shape: { incidentId: z.string().describe("The incident ID to inspect") },
  read: async (target, { client, engineId, ...urls }) => ({
    ...(await buildIncidentDetailData(client, { ...urls, ...target })),
    engineId,
  }),
})

/** Every `*_data` feed of the cockpit in registration order; a route's feed must be listed. */
export const DATA_FEEDS: readonly DataFeed[] = [
  overviewFeed,
  healthFeed,
  clusterDetailFeed,
  processInstancesFeed,
  bpmnXmlFeed,
  instanceDetailFeed,
  historyTimelineFeed,
  jobsFeed,
  jobBacklogFeed,
  incidentsFeed,
  processIncidentsFeed,
  activityIncidentsFeed,
  activityStatisticsFeed,
  incidentDetailFeed,
]
