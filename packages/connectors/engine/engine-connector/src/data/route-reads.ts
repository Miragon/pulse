import type { Client } from "@miragon/pulse-engine-client"
import type { EngineProvider } from "../engine-provider.js"
import { HISTORY_PAGE_SIZE } from "../view-models.js"
import { buildClusterDetailData } from "./cluster-detail-data.js"
import {
  buildCockpitDashboardData,
  buildJobPanelData,
  buildProcessInstancesData,
} from "./cockpit-data.js"
import { buildEngineHealthData, type EngineHealthThresholds } from "./health-data.js"
import { buildHistoryTimelineData } from "./history-timeline-data.js"
import { buildIncidentDetailData } from "./incident-detail-data.js"
import { buildIncidentsDashboardData } from "./incidents-dashboard-data.js"
import { buildInstanceDetailData } from "./instance-detail-data.js"
import { buildProcessIncidentsData } from "./process-incidents-data.js"

/**
 * Each cockpit route's read, defined once: its `*_data` feed runs it with the widget's args and
 * `engine_open_cockpit` with the first page's, so a start view's data is the feed's payload by
 * construction. The feeds that add `engineId` to a builder's result add it here.
 */

/** The resolved engine a read runs on (`resolveEngine`'s result). */
export interface ReadEngine {
  client: Client
  engineId: string
  baseUrl: string
  cockpitUrl?: string
  provider: EngineProvider
}

type ArgsOf<F> = F extends (client: Client, engineId: string, args: infer A) => unknown ? A : never
type OptionsOf<F> = F extends (client: Client, options: infer O) => unknown
  ? Omit<O, "baseUrl" | "cockpitUrl" | "provider">
  : never

export const readCockpitOverview = (_: object, { client, engineId }: ReadEngine) =>
  buildCockpitDashboardData(client, engineId)

export const readEngineHealth = (
  { client, engineId }: ReadEngine,
  thresholds: EngineHealthThresholds,
) => buildEngineHealthData(client, engineId, thresholds)

export const readClusterDetail = (
  args: ArgsOf<typeof buildClusterDetailData>,
  { client, engineId }: ReadEngine,
) => buildClusterDetailData(client, engineId, args)

export const readProcessInstances = (
  args: ArgsOf<typeof buildProcessInstancesData>,
  { client, engineId }: ReadEngine,
) => buildProcessInstancesData(client, engineId, args)

export const readJobs = (
  args: ArgsOf<typeof buildJobPanelData>,
  { client, engineId }: ReadEngine,
) => buildJobPanelData(client, engineId, args)

export const readInstanceDetail = (
  target: { processInstanceId: string },
  { client, engineId, ...urls }: ReadEngine,
) => buildInstanceDetailData(client, engineId, target, urls)

export const readHistoryTimeline = (
  { processInstanceId }: { processInstanceId: string },
  { client, engineId }: ReadEngine,
) =>
  buildHistoryTimelineData(client, engineId, { processInstanceId, maxResults: HISTORY_PAGE_SIZE })

export const readIncidents = async (
  filters: OptionsOf<typeof buildIncidentsDashboardData>,
  { client, engineId, ...urls }: ReadEngine,
) => ({ ...(await buildIncidentsDashboardData(client, { ...urls, ...filters })), engineId })

export const readProcessIncidents = async (
  target: OptionsOf<typeof buildProcessIncidentsData>,
  { client, engineId, ...urls }: ReadEngine,
) => ({ ...(await buildProcessIncidentsData(client, { ...urls, ...target })), engineId })

export const readIncidentDetail = async (
  target: OptionsOf<typeof buildIncidentDetailData>,
  { client, engineId, ...urls }: ReadEngine,
) => ({ ...(await buildIncidentDetailData(client, { ...urls, ...target })), engineId })
