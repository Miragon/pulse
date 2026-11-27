import type { Client } from "@miragon/pulse-c7-client"
import {
  elementOfActivity,
  engineDateMillis,
  isRootIncident,
  latestEngineDate,
  multiInstanceBodyOf,
} from "@miragon/pulse-c7-core"
import {
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
import { countOf, optional } from "./engine-reads.js"
import {
  fetchBusinessKeys,
  groupBy,
  readIncidents,
  scanFacts,
  scanIncidents,
  toIncidentInstance,
  type IncidentRow,
  type IncidentScan,
  type RowWindow,
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
 * reads them. A call activity's copy of a called instance's incident counts in the called process,
 * and a multi-instance body's on the activity it repeats (`elementOfActivity`), the element of the
 * diagram, as the element statistics count it.
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
  const scanned = groupBy(roots, (r) => elementOfActivity(r.activityId))
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
 * The open root incidents per element of the diagram: a complete scan already holds every incident
 * of the key, so its root incidents are exact, a multi-instance body's on its activity; otherwise
 * each version that holds a root incident is read by the shared process screen's rule
 * (`readElementCounts`: its statistics with every incident at an element, the body's on its
 * activity, and the incidents at its call activities whole).
 */
async function activityIncidentCounts(
  client: Client,
  read: { scan: IncidentScan; roots: IncidentRow[]; stats: KeyStats | undefined },
): Promise<Map<string, number>> {
  if (read.scan.complete) {
    const byElement = groupBy(read.roots, (r) => elementOfActivity(r.activityId))
    return new Map([...byElement].map(([id, rows]) => [id, rows.length]))
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

/** Where a page's root incidents lie: a key's incidents at one activity id. */
interface RootsAt {
  processDefinitionKeyIn: string
  activityId: string
}

/**
 * How a window of the root incidents at one activity id is read, whole or paged by the engine, and
 * how many lie there; `counted`, what the engine's `/incident/count` already counted there.
 */
type RootsRead = (
  client: Client,
  filter: RootsAt,
  window: RowWindow,
  counted?: number,
) => Promise<RootsPage>

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
 * windowed in memory and counted, so no copy is a row or part of the total, nor is a count, which
 * holds the copies.
 */
async function rootsReadWhole(
  client: Client,
  filter: RootsAt,
  window: RowWindow,
): Promise<RootsPage> {
  const roots = (await readIncidents(client, filter)).filter(isRootIncident)
  return { rows: roots.slice(window.first, window.first + window.size), totalCount: roots.length }
}

/**
 * Where no copy lies: the engine pages the activity's incidents (`readIncidents`) and
 * `/incident/count` counts them, unless already counted.
 */
async function rootsPagedByEngine(
  client: Client,
  filter: RootsAt,
  window: RowWindow,
  counted?: number,
): Promise<RootsPage> {
  const [rows, totalCount] = await Promise.all([
    readIncidents(client, filter, window),
    counted ?? getIncidentsCount({ client, query: filter }).then(countOf),
  ])
  return { rows, totalCount }
}

/** The newer incident first, by the instant the engine raised it. */
function newerFirst(left: IncidentRow, right: IncidentRow): number {
  return (
    (engineDateMillis(right.incidentTimestamp) ?? 0) -
    (engineDateMillis(left.incidentTimestamp) ?? 0)
  )
}

/**
 * A page of the element's root incidents and its multi-instance body's (`multiInstanceBodyOf`),
 * which Camunda 7 raises under an id of its own and the element's group counts on the element.
 * Where the body holds none (its `/incident/count`), the element's page alone. Else only the rows
 * of each that the page can hold, read by `read`: the body's from its first to the page's end, with
 * that count, and the element's from as many before the page's first as the body counts, to the
 * page's end. The two are merged newest first, the element's row first on a tie, and their totals
 * summed, so every page is a slice of the one merged list, and no request asks more rows than a
 * page of `readIncidents`.
 */
async function rootsAtElement(
  client: Client,
  read: RootsRead,
  element: RootsAt,
  page: RowWindow,
): Promise<RootsPage> {
  const body = { ...element, activityId: multiInstanceBodyOf(element.activityId) }
  const atBody = await getIncidentsCount({ client, query: body }).then(countOf)
  if (atBody === 0) return read(client, element, page)
  // A row lies in the merged list at its own list's index or later, so none past the page's end
  // reaches the page, and an element's row at most `atBody` places later, so the page starts at its
  // row `from` or after. Of the rows before the page's end, the windows leave out only the
  // element's before `from`, which all precede the page, so the page's row `i` is the windows'
  // row `offset + i`.
  const end = page.first + page.size
  const from = Math.max(0, page.first - atBody)
  const [ofBody, own] = await Promise.all([
    read(client, body, { first: 0, size: Math.min(atBody, end) }, atBody),
    read(client, element, { first: from, size: end - from }),
  ])
  const merged = [...own.rows, ...ofBody.rows].sort(newerFirst)
  const offset = page.first - from
  return {
    rows: merged.slice(offset, offset + page.size),
    totalCount: own.totalCount + ofBody.totalCount,
  }
}

/**
 * A page of an activity's open ROOT incidents, newest first, as its group counts them (owner
 * decision D2, amended on 2026-11-19): a call activity's copy of a called instance's incident is no
 * row and no part of the total. Copies only lie at a call activity (`mayHoldCopies`, by the key's
 * latest diagram, read through the one XML cache, which also names the rows' element): there the
 * activity's incidents are read whole and its root incidents paged in memory; anywhere else the
 * engine pages them and `/incident/count` counts them. A multi-instance body's root incidents are
 * the activity's too (`rootsAtElement`), each row under its own id. Each row links to its OWN
 * definition version, so no definition lookup runs per page (N67). An unknown key is a not-found
 * error.
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
  const read = mayHoldCopies(bpmnXml, options.activityId) ? rootsReadWhole : rootsPagedByEngine
  const { rows, totalCount } = await rootsAtElement(client, read, filter, { first, size })
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
