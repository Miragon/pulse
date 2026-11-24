import type { Client } from "@miragon/pulse-c7-client"
import { isRootIncident, latestEngineDate } from "@miragon/pulse-c7-core"
import {
  getIncidents,
  getIncidentsCount,
  getJobsCount,
  getProcessInstancesCount,
} from "@miragon/pulse-c7-client/sdk"
import { bpmnProcessNameOf, readBpmnNames } from "@miragon/pulse-widget-shell/server"
import type {
  ActivityIncidentsData,
  IncidentsByProcess,
  ProcessIncidentsActivity,
  ProcessIncidentsData,
} from "../view-models.js"
import type { ActivityIncidentsFilters, PagingArgs } from "../feed-contracts.js"
import type { EngineProvider } from "../engine-provider.js"
import { buildProcessCockpitUrl } from "../lib/engine/cockpit-url.js"
import { bpmnActivityIds, bpmnCallActivityIds } from "../lib/bpmn/bpmn-parse.js"
import {
  fetchDefinitionXml,
  fetchLatestDefinition,
  fetchStatsByKey,
  nameUnnamedDefinitions,
  type KeyStats,
} from "./definition-info.js"
import { readElementCounts } from "./element-counts.js"
import { countOf, optional, rowsOf } from "./engine-reads.js"
import {
  fetchBusinessKeys,
  groupBy,
  readAllIncidents,
  scanFacts,
  scanIncidents,
  toIncidentInstance,
  type IncidentRow,
  type IncidentScan,
} from "./incident-scan.js"

/**
 * The running instances of a key, every version, as the process detail counts them: one count,
 * which `engine_process_stats` reads too.
 */
export function countRunningInstances(client: Client, key: string): Promise<number> {
  return getProcessInstancesCount({ client, query: { processDefinitionKey: key } }).then(countOf)
}

/** The jobs of a key whose retries are used up, every version, as the process detail counts them. */
export function countFailedJobs(client: Client, key: string): Promise<number> {
  return getJobsCount({ client, query: { processDefinitionKey: key, noRetriesLeft: true } }).then(
    countOf,
  )
}

export interface ProcessIncidentsOptions {
  baseUrl: string
  cockpitUrl?: string
  provider: EngineProvider
  processDefinitionKey: string
}

/**
 * KEY-wide (#335 N60): old versions keep running after a redeploy, so every number covers every
 * version; only the diagram is one version. Its incidents are the key's open ROOT incidents (owner
 * decision D2, amended on 2026-11-19): the definition statistics' (`rootIncidents=true`), and per
 * activity the scan's root incidents (`isRootIncident`) where the scan holds every incident of the
 * key, else each root-carrying version's element statistics, read as the shared process screen
 * reads them. A call activity's copy of a called instance's incident counts in the called process.
 */
export async function buildProcessIncidentsData(
  client: Client,
  options: ProcessIncidentsOptions,
): Promise<ProcessIncidentsData> {
  const key = options.processDefinitionKey
  const nowMs = Date.now()
  const byKey = { processDefinitionKeyIn: key }
  const [definition, runningInstances, failedJobs, statsByKey, scan] = await Promise.all([
    // Primary: an unknown key is a not-found error, never a view of zeros.
    fetchLatestDefinition(client, key),
    countRunningInstances(client, key),
    countFailedJobs(client, key),
    fetchStatsByKey(client, {}),
    scanIncidents(client, byKey),
  ])

  const stats = statsByKey.get(key)
  const incidentCount = stats?.incidentCount ?? 0
  const roots = scan.rows.filter(isRootIncident)
  const [bpmnXml, activityCounts, siblingsWithIncidents] = await Promise.all([
    definition.id ? optional(fetchDefinitionXml(client, definition.id)) : Promise.resolve(null),
    activityIncidentCounts(client, { scan, roots, stats }),
    // For the empty state alone; null otherwise, never an unread `[]`.
    incidentCount === 0 ? siblingsWithIncidentsOf(client, statsByKey, key) : Promise.resolve(null),
  ])

  const diagramIds = bpmnXml ? new Set(bpmnActivityIds(bpmnXml)) : null
  const diagramNames = readBpmnNames(bpmnXml ?? "")
  const activities = toActivities(activityCounts, roots, diagramNames.elements)
  return {
    processDefinitionKey: key,
    // The engine's name, else the diagram's (a Modeler pool around an unnamed process).
    processDefinitionName: definition.name ?? bpmnProcessNameOf(diagramNames, key),
    diagramVersion: definition.version,
    diagramDefinitionId: bpmnXml && definition.id ? definition.id : null,
    cockpitUrl: buildProcessCockpitUrl(
      options,
      { key, version: definition.version, definitionId: definition.id || null },
      { tab: "incidents" },
    ),
    runningInstances,
    incidentCount,
    failedJobs,
    totalActivityCount: diagramIds ? diagramIds.size : null,
    // Same scope as the denominator: an activity only an older version has
    // stays out of "X of the diagram's Y".
    affectedDiagramActivityCount: diagramIds
      ? activities.filter((a) => diagramIds.has(a.activityId)).length
      : null,
    latestIncident: latestEngineDate(roots.map((r) => r.incidentTimestamp)),
    activities,
    siblingsWithIncidents,
    fetchedAt: new Date(nowMs).toISOString(),
    engineVendor: options.provider.branding.displayName,
  }
}

function toActivities(
  counts: Map<string, number>,
  roots: IncidentRow[],
  names: Record<string, string>,
): ProcessIncidentsActivity[] {
  const scanned = groupBy(roots, (r) => r.activityId)
  return [...counts.entries()]
    .map(([activityId, incidentCount]) => {
      const rows = scanned.get(activityId) ?? []
      const facts = scanFacts(rows, { fullyScanned: rows.length >= incidentCount })
      return {
        activityId,
        activityName: names[activityId] ?? null,
        representativeMessage: facts.representativeMessage,
        incidentCount,
        firstSeen: facts.firstSeen,
        latestIncident: facts.latestIncident,
      }
    })
    .sort((a, b) => b.incidentCount - a.incidentCount)
}

/**
 * The open root incidents per activity: a complete scan already holds every incident of the key, so
 * its root incidents are exact; otherwise each version that holds a root incident is read by the
 * shared process screen's rule (`readElementCounts`: its statistics with every incident at an
 * element, and the incidents at its call activities whole).
 */
async function activityIncidentCounts(
  client: Client,
  read: { scan: IncidentScan; roots: IncidentRow[]; stats: KeyStats | undefined },
): Promise<Map<string, number>> {
  if (read.scan.complete) {
    return new Map(
      [...groupBy(read.roots, (r) => r.activityId)].map(([id, rows]) => [id, rows.length]),
    )
  }
  const perElement = await readElementCounts(client, read.stats?.incidentVersionIds ?? [])
  return new Map(
    [...perElement]
      .filter(([, counts]) => counts.incidents > 0)
      .map(([id, counts]) => [id, counts.incidents]),
  )
}

/** The other processes with open root incidents, the most first, from the statistics read. */
async function siblingsWithIncidentsOf(
  client: Client,
  statsByKey: Map<string, KeyStats>,
  excludeKey: string,
): Promise<IncidentsByProcess[]> {
  const siblings = [...statsByKey.entries()]
    .filter(([key, stats]) => key !== excludeKey && stats.incidentCount > 0)
    .sort((a, b) => b[1].incidentCount - a[1].incidentCount)
  // A Modeler pool around an unnamed process names it, as every view names it (enrichment).
  await nameUnnamedDefinitions(
    client,
    siblings.map(([, stats]) => stats.latest),
  )
  return siblings.map(([key, stats]) => ({
    processDefinitionKey: key,
    processDefinitionName: stats.latest.name,
    incidentCount: stats.incidentCount,
  }))
}

export type ActivityIncidentsArgs = ActivityIncidentsFilters & PagingArgs

const ACTIVITY_INCIDENTS_PAGE = 10

/** A page of an activity's root incidents and how many it holds. */
interface RootsPage {
  rows: IncidentRow[]
  totalCount: number
}

/**
 * Whether the activity may hold a call activity's copies of its called instances' incidents: it is
 * a call activity in the key's latest diagram, or that diagram cannot tell (unread, or without the
 * element, which only an older version has).
 */
function mayHoldCopies(bpmnXml: string | null, activityId: string): boolean {
  return (
    bpmnXml === null ||
    bpmnCallActivityIds(bpmnXml).includes(activityId) ||
    !bpmnActivityIds(bpmnXml).includes(activityId)
  )
}

/**
 * Where copies may lie: the activity's incidents read whole, its root incidents (`isRootIncident`)
 * paged in memory and counted, so no copy is a row or part of the total.
 */
async function rootsReadWhole(
  client: Client,
  filter: { processDefinitionKeyIn: string; activityId: string },
  first: number,
  size: number,
): Promise<RootsPage> {
  const roots = (await readAllIncidents(client, filter)).filter(isRootIncident)
  return { rows: roots.slice(first, first + size), totalCount: roots.length }
}

/** Where no copy lies: the engine pages the activity's incidents and counts them. */
async function rootsPagedByEngine(
  client: Client,
  filter: { processDefinitionKeyIn: string; activityId: string },
  first: number,
  size: number,
): Promise<RootsPage> {
  const [rows, totalCount] = await Promise.all([
    getIncidents({
      client,
      query: {
        ...filter,
        sortBy: "incidentTimestamp",
        sortOrder: "desc",
        firstResult: first,
        maxResults: size,
      },
    }).then((answer) => rowsOf<IncidentRow>(answer)),
    getIncidentsCount({ client, query: filter }).then(countOf),
  ])
  return { rows, totalCount }
}

/**
 * A page of an activity's open ROOT incidents, newest first, as its group counts them (owner
 * decision D2, amended on 2026-11-19): a call activity's copy of a called instance's incident is no
 * row and no part of the total. Copies only lie at a call activity (`mayHoldCopies`, by the key's
 * latest diagram, read through the one XML cache, which also names the rows' element): there the
 * activity's incidents are read whole and its root incidents paged in memory; anywhere else the
 * engine pages them and `/incident/count` counts them. Each row links to its OWN definition
 * version, so no definition lookup runs per page (N67). An unknown key is a not-found error.
 */
export async function buildActivityIncidentsData(
  client: Client,
  options: {
    baseUrl: string
    cockpitUrl?: string
    provider: EngineProvider
  } & ActivityIncidentsArgs,
): Promise<Omit<ActivityIncidentsData, "engineId">> {
  const filter = {
    processDefinitionKeyIn: options.processDefinitionKey,
    activityId: options.activityId,
  }
  const first = Math.max(0, options.firstResult ?? 0)
  const size = options.maxResults ?? ACTIVITY_INCIDENTS_PAGE
  // Primary: an unknown key is a not-found error, never a page of zeros.
  const latest = await fetchLatestDefinition(client, options.processDefinitionKey)
  // Enrichment: an unread diagram names no element and leaves the copies to the whole read.
  const bpmnXml = latest.id ? await optional(fetchDefinitionXml(client, latest.id)) : null
  const { rows, totalCount } = mayHoldCopies(bpmnXml, options.activityId)
    ? await rootsReadWhole(client, filter, first, size)
    : await rootsPagedByEngine(client, filter, first, size)
  const names = readBpmnNames(bpmnXml ?? "").elements
  const activityName = Object.hasOwn(names, options.activityId) ? names[options.activityId] : null
  // Enrichment: a failed read names the rows by their short ids.
  const businessKeys = await optional(
    fetchBusinessKeys(
      client,
      rows.map((r) => r.processInstanceId),
    ),
  )
  return {
    processDefinitionKey: options.processDefinitionKey,
    activityId: options.activityId,
    incidents: rows.map((r) => toIncidentInstance(r, options, businessKeys, activityName)),
    totalCount,
  }
}
