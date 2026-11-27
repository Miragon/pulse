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
 * (`activityIncidentCounts`): the key's scan where it holds every incident of the key, else the
 * element counts of the versions that hold a root incident, on their floor of 30 s per caller; and
 * never fewer than the rows read and one more, so no total the page disproves. Each row links to
 * its OWN definition version, so no definition lookup runs per page (N67). An unknown key is a
 * not-found error, and a cursor of another paging fails the call.
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
import { fetchDefinitionXml, fetchLatestDefinition, fetchStatsByKey } from "./definition-info.js"
import { optional } from "./engine-reads.js"
import {
  fetchBusinessKeys,
  type IncidentRow,
  scanIncidents,
  toIncidentInstance,
} from "./incident-scan.js"
import { activityIncidentCounts } from "./process-incidents-data.js"

/** The rows of a page without `maxResults`; the widget asks the same. */
const ACTIVITY_INCIDENTS_PAGE = 10

/** What the page needs besides its arguments: the engine's links and vendor. */
export interface ActivityIncidentsOptions extends ActivityIncidentsPageArgs {
  baseUrl: string
  cockpitUrl?: string
  provider: EngineProvider
}

/** An activity of a key: where a page's root incidents lie. */
interface ActivityRef {
  readonly key: string
  readonly activityId: string
}

/**
 * The element's open root incidents as its group on the process route counts them, by the same
 * read (`activityIncidentCounts`): the key's scan where it holds every incident of the key, else
 * the element counts of the key's versions that hold a root incident, which only then are read.
 */
async function rootsAsGrouped(client: Client, { key, activityId }: ActivityRef): Promise<number> {
  const scan = await scanIncidents(client, { processDefinitionKeyIn: key })
  const stats = scan.complete ? undefined : (await fetchStatsByKey(client, {})).get(key)
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

/** The page of root incidents `options` asks for, by c7-core's paging of the element's two lists. */
function rootsPage(
  client: Client,
  options: ActivityIncidentsOptions,
): Promise<Page<ElementIncident>> {
  const element = {
    bpmnProcessId: BpmnProcessId(options.processDefinitionKey),
    elementId: ElementId(options.activityId),
  }
  const limit = options.maxResults ?? ACTIVITY_INCIDENTS_PAGE
  const page = options.after === undefined ? { limit } : { limit, after: PageCursor(options.after) }
  return c7RuntimeOf(client).searchElementRootIncidents(element, page)
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
  const activity = { key: options.processDefinitionKey, activityId: options.activityId }
  // Primary: an unknown key is a not-found error, never a page of zeros.
  const latest = await fetchLatestDefinition(client, activity.key)
  const [bpmnXml, page] = await Promise.all([
    // Enrichment: an unread diagram names no element.
    latest.id ? optional(fetchDefinitionXml(client, latest.id)) : Promise.resolve(null),
    rootsPage(client, options),
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
    processDefinitionKey: activity.key,
    activityId: activity.activityId,
    incidents: rows.map((r) => toIncidentInstance(r, options, businessKeys, activityName)),
    totalCount,
    next: page.next ?? null,
  }
}
