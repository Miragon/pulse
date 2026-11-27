/**
 * A page of an activity's open ROOT incidents (`engine_activity_incidents_data`), newest first and
 * then by id, as its group on the process route counts them (owner decision D2, amended on
 * 2026-11-19): the incidents raised at the element and at its multi-instance body, which Camunda 7
 * names by an id of its own, a call activity's copy of a called instance's incident no row of it.
 * The rows are c7-core's (`searchElementRootIncidents` of `C7Runtime` over the connector's port):
 * each list paged by its own cursor over the runs of incidents raised at one instant and the two
 * merged, so a page goes on by the cursor of the page before (`after`, its `next`) and no incident
 * repeats or goes missing where the engine orders those runs anew (#690). Rows are read on every
 * call, so a write's invalidation reads them anew.
 *
 * The total is honest (invariant 7) and the first page's alone, since a list's total is its first
 * page's: a later page reads none. A first page read whole totals its rows, root incidents alone
 * over every version. A first page with more counts the element as its group counts it
 * (`activityIncidentCounts`): the process's scan where it holds every incident of the process,
 * else the element counts of the versions that hold a root incident, on their floor of 30 s per
 * caller; and never fewer than the rows read and one more, so no total the page disproves. Each row
 * links to its OWN definition version, so no definition lookup runs per page (N67). The page is one
 * process's, a key in one tenant (`readCockpitProcess`): where the key is deployed in other tenants
 * too, the rows and the scan are read by the ids of the process's versions that hold a root
 * incident (the floored statistics name them), so another tenant's incidents are never read, and
 * the counts are its versions'. An unknown key or tenant is a not-found error, and a cursor of
 * another paging fails the call.
 */

import type { Client } from "@miragon/pulse-c7-client"
import { isRootIncident } from "@miragon/pulse-c7-core"
import type { ElementIncident } from "@miragon/pulse-c7-core/runtime"
import { BpmnProcessId, ElementId, type Page, PageCursor } from "@miragon/pulse-engine-core"
import { readBpmnNames } from "@miragon/pulse-widget-shell/server"
import type { ActivityIncidentsData } from "../view-models.js"
import type { ActivityIncidentsPageArgs } from "../feed-contracts.js"
import type { EngineProvider } from "../engine-provider.js"
import { c7RuntimeOf } from "../lib/engine/engine-runtime.js"
import {
  type CockpitProcess,
  incidentVersionsOf,
  readCockpitProcess,
  scanOfProcess,
  statsOfProcess,
} from "./cockpit-process.js"
import { fetchDefinitionXml, type KeyStats } from "./definition-info.js"
import { optional } from "./engine-reads.js"
import { fetchBusinessKeys, type IncidentRow, toIncidentInstance } from "./incident-scan.js"
import { activityIncidentCounts } from "./process-incidents-data.js"
import { readStatistics } from "./statistics-floor.js"

/** The rows of a page without `maxResults`; the widget asks the same. */
const ACTIVITY_INCIDENTS_PAGE = 10

/** What the page needs besides its arguments: the engine's links and vendor. */
export interface ActivityIncidentsOptions extends ActivityIncidentsPageArgs {
  baseUrl: string
  cockpitUrl?: string
  provider: EngineProvider
}

/** An activity of a process: where a page's root incidents lie, and the process's statistics. */
interface ActivityRef {
  readonly process: CockpitProcess
  readonly activityId: string
  /** Its statistics of the floored read; read only where its key holds other processes. */
  readonly stats: KeyStats | undefined
}

/**
 * The element's open root incidents as its group on the process route counts them, by the same
 * read (`activityIncidentCounts`): the process's scan where it holds every incident of the process,
 * else the element counts of the process's versions that hold a root incident, which only then are
 * read.
 */
async function rootsAsGrouped(client: Client, activity: ActivityRef): Promise<number> {
  const { process, activityId } = activity
  const scan = await scanOfProcess(client, process, activity.stats)
  const stats =
    activity.stats ?? (scan.complete ? undefined : await statsRead(client, process, true))
  const roots = scan.rows.filter(isRootIncident)
  return (await activityIncidentCounts(client, { scan, roots, stats })).get(activityId) ?? 0
}

/**
 * The total a page answers: none after the first (`after`), whose total the list keeps; the rows
 * of a first page read whole; else the element's as grouped, never below the rows and one more.
 */
async function totalOf(
  client: Client,
  activity: ActivityRef,
  read: { readonly after: string | undefined; readonly page: Page<ElementIncident> },
): Promise<number | null> {
  const { after, page } = read
  if (after !== undefined) return null
  if (page.next === undefined) return page.items.length
  return Math.max(await rootsAsGrouped(client, activity), page.items.length + 1)
}

/**
 * The page of root incidents `options` asks for, by c7-core's paging of the element's two lists:
 * the key's, or, where its key holds other processes, those of the process's versions that hold a
 * root incident, each by its id.
 */
function rootsPage(
  client: Client,
  options: ActivityIncidentsOptions,
  activity: ActivityRef,
): Promise<Page<ElementIncident>> {
  const definitionIds = incidentVersionsOf(activity.process, activity.stats)
  const element = {
    bpmnProcessId: BpmnProcessId(options.processDefinitionKey),
    elementId: ElementId(options.activityId),
    ...(definitionIds === undefined ? {} : { definitionIds }),
  }
  const limit = options.maxResults ?? ACTIVITY_INCIDENTS_PAGE
  const page = options.after === undefined ? { limit } : { limit, after: PageCursor(options.after) }
  return c7RuntimeOf(client).searchElementRootIncidents(element, page)
}

/**
 * The process's statistics of the floored read where `needed`: a process whose key holds others
 * names the versions its incidents are read by, one alone only where its scan falls short.
 */
async function statsRead(
  client: Client,
  process: CockpitProcess,
  needed: boolean,
): Promise<KeyStats | undefined> {
  return needed ? statsOfProcess((await readStatistics(client)).rows, process) : undefined
}

/** A root incident as the connector's incident views read a row. */
function rowOf(incident: ElementIncident): IncidentRow {
  return {
    id: incident.id,
    processDefinitionId: incident.processDefinitionId,
    processInstanceId: incident.processInstanceId,
    incidentType: incident.incidentType,
    activityId: incident.activityId,
    incidentMessage: incident.incidentMessage ?? null,
    incidentTimestamp: incident.incidentTimestamp,
    configuration: incident.configuration ?? null,
    rootCauseIncidentId: incident.rootCauseIncidentId ?? null,
  }
}

/** A page of an activity's open root incidents, newest first, by its cursor, and how many it holds. */
export async function buildActivityIncidentsData(
  client: Client,
  options: ActivityIncidentsOptions,
): Promise<Omit<ActivityIncidentsData, "engineId">> {
  // Primary: an unknown key or tenant is a not-found error, never a page of zeros.
  const process = await readCockpitProcess(client, options.processDefinitionKey, options.tenantId)
  const stats = await statsRead(client, process, !process.alone)
  const activity = { process, activityId: options.activityId, stats }
  const [bpmnXml, page] = await Promise.all([
    // Enrichment: an unread diagram names no element.
    optional(fetchDefinitionXml(client, process.latest.id)),
    rootsPage(client, options, activity),
  ])
  const rows = page.items.map(rowOf)
  const names = readBpmnNames(bpmnXml ?? "").elements
  const activityName = Object.hasOwn(names, activity.activityId) ? names[activity.activityId] : null
  const [totalCount, businessKeys] = await Promise.all([
    totalOf(client, activity, { after: options.after, page }),
    // Enrichment: a failed read names the rows by their short ids.
    optional(
      fetchBusinessKeys(
        client,
        rows.map((r) => r.processInstanceId),
      ),
    ),
  ])
  return {
    processDefinitionKey: process.key,
    ...(process.tenantId === null ? {} : { tenantId: process.tenantId }),
    activityId: activity.activityId,
    incidents: rows.map((r) => toIncidentInstance(r, options, businessKeys, activityName)),
    totalCount,
    next: page.next ?? null,
  }
}
