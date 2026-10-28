import { latestEngineDate, toEngineDate, type Client } from "@miragon/pulse-camunda7-client"
import {
  getActivityStatistics,
  getIncidents,
  getIncidentsCount,
  getJobsCount,
  getProcessInstancesCount,
} from "@miragon/pulse-camunda7-client/sdk"
import { bpmnProcessNameOf, readBpmnNames } from "@miragon/pulse-widget-shell/server"
import type {
  ActivityIncidentsData,
  IncidentsByProcess,
  ProcessIncidentsActivity,
  ProcessIncidentsData,
} from "../view-models.js"
import type { ActivityIncidentsFilters, PagingArgs } from "../feed-contracts.js"
import type { EngineProvider } from "../engine-provider.js"
import { buildProcessCockpitUrl } from "../lib/cockpit-url.js"
import { bpmnActivityIds } from "../lib/bpmn-parse.js"
import {
  fetchDefinitionXml,
  fetchLatestDefinition,
  fetchStatsByKey,
  nameUnnamedDefinitions,
} from "./definition-info.js"
import { countOf, DAY_MS, optional, rowsOf } from "./engine-reads.js"
import {
  fetchBusinessKeys,
  groupBy,
  scanFacts,
  scanIncidents,
  toIncidentInstance,
  type IncidentRow,
  type IncidentScan,
} from "./incident-scan.js"

export interface ProcessIncidentsOptions {
  baseUrl: string
  cockpitUrl?: string
  provider: EngineProvider
  processDefinitionKey: string
}

/**
 * KEY-wide (#335 N60): old versions keep running after a redeploy, so every
 * number covers every version; only the diagram is one version. The engine-wide
 * definition statistics are read only when the key's incidents outrun the scan.
 */
export async function buildProcessIncidentsData(
  client: Client,
  options: ProcessIncidentsOptions,
): Promise<ProcessIncidentsData> {
  const key = options.processDefinitionKey
  const cutoffMs = Date.now() - DAY_MS
  const byKey = { processDefinitionKeyIn: key }
  const [definition, runningInstances, failedJobs, incidentCount, last24hCount, scan] =
    await Promise.all([
      // Primary: an unknown key is a not-found error, never a view of zeros.
      fetchLatestDefinition(client, key),
      getProcessInstancesCount({ client, query: { processDefinitionKey: key } }).then(countOf),
      getJobsCount({ client, query: { processDefinitionKey: key, noRetriesLeft: true } }).then(
        countOf,
      ),
      getIncidentsCount({ client, query: byKey }).then(countOf),
      getIncidentsCount({
        client,
        query: { ...byKey, incidentTimestampAfter: toEngineDate(new Date(cutoffMs)) },
      }).then(countOf),
      scanIncidents(client, byKey),
    ])

  const [bpmnXml, activityCounts, siblingsWithIncidents] = await Promise.all([
    definition.id ? optional(fetchDefinitionXml(client, definition.id)) : Promise.resolve(null),
    activityIncidentCounts(client, key, scan),
    // Read for the empty state alone; null otherwise, never an unread `[]`.
    incidentCount === 0 ? optional(fetchSiblingsWithIncidents(client, key)) : Promise.resolve(null),
  ])

  const diagramIds = bpmnXml ? new Set(bpmnActivityIds(bpmnXml)) : null
  const diagramNames = readBpmnNames(bpmnXml ?? "")
  const activities = toActivities(activityCounts, scan, {
    names: diagramNames.elements,
    cutoffMs,
  })
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
    last24hCount,
    failedJobs,
    totalActivityCount: diagramIds ? diagramIds.size : null,
    // Same scope as the denominator: an activity only an older version has
    // stays out of "X of the diagram's Y".
    affectedDiagramActivityCount: diagramIds
      ? activities.filter((a) => diagramIds.has(a.activityId)).length
      : null,
    latestIncident: latestEngineDate(scan.rows.map((r) => r.incidentTimestamp)),
    activities,
    siblingsWithIncidents,
    engineVendor: options.provider.branding.displayName,
  }
}

function toActivities(
  counts: Map<string, number>,
  scan: IncidentScan,
  ctx: { names: Record<string, string>; cutoffMs: number },
): ProcessIncidentsActivity[] {
  const scanned = groupBy(scan.rows, (r) => r.activityId)
  return [...counts.entries()]
    .map(([activityId, incidentCount]) => {
      const rows = scanned.get(activityId) ?? []
      const facts = scanFacts(rows, {
        fullyScanned: rows.length >= incidentCount,
        scan,
        cutoffMs: ctx.cutoffMs,
      })
      return {
        activityId,
        activityName: ctx.names[activityId] ?? null,
        representativeMessage: facts.representativeMessage,
        incidentCount,
        firstSeen: facts.firstSeen,
        latestIncident: facts.latestIncident,
      }
    })
    .sort((a, b) => b.incidentCount - a.incidentCount)
}

/** A complete scan already holds every incident; otherwise sum each incident-carrying version's statistics. */
async function activityIncidentCounts(
  client: Client,
  key: string,
  scan: IncidentScan,
): Promise<Map<string, number>> {
  if (scan.complete) {
    return new Map(
      [...groupBy(scan.rows, (r: IncidentRow) => r.activityId)].map(([id, rows]) => [
        id,
        rows.length,
      ]),
    )
  }
  const versionIds = (await fetchStatsByKey(client, {})).get(key)?.incidentVersionIds ?? []
  const perVersion = await Promise.all(
    versionIds.map((id) =>
      getActivityStatistics({ client, path: { id }, query: { incidents: true } }).then((rows) =>
        rowsOf<{ id?: string | null; incidents?: Array<{ incidentCount?: number | null }> | null }>(
          rows,
        ),
      ),
    ),
  )
  const counts = new Map<string, number>()
  for (const row of perVersion.flat()) {
    const count = (row.incidents ?? []).reduce((sum, i) => sum + (i.incidentCount ?? 0), 0)
    if (row.id && count > 0) counts.set(row.id, (counts.get(row.id) ?? 0) + count)
  }
  return counts
}

async function fetchSiblingsWithIncidents(
  client: Client,
  excludeKey: string,
): Promise<IncidentsByProcess[]> {
  const siblings = [...(await fetchStatsByKey(client, {})).entries()]
    .filter(([key, stats]) => key !== excludeKey && stats.incidentCount > 0)
    .sort((a, b) => b[1].incidentCount - a[1].incidentCount)
  // A Modeler pool around an unnamed process names it, as analytics names it.
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

/** Each row links to its OWN definition version, so no definition lookup runs per page (N67). */
export async function buildActivityIncidentsData(
  client: Client,
  options: {
    baseUrl: string
    cockpitUrl?: string
    provider: EngineProvider
  } & ActivityIncidentsArgs,
): Promise<Omit<ActivityIncidentsData, "engineId">> {
  const query = {
    processDefinitionKeyIn: options.processDefinitionKey,
    activityId: options.activityId,
  }
  const [raw, totalCount] = await Promise.all([
    getIncidents({
      client,
      query: {
        ...query,
        sortBy: "incidentTimestamp",
        sortOrder: "desc",
        firstResult: Math.max(0, options.firstResult ?? 0),
        maxResults: options.maxResults ?? ACTIVITY_INCIDENTS_PAGE,
      },
    }).then((rows) => rowsOf<IncidentRow>(rows)),
    getIncidentsCount({ client, query }).then(countOf),
  ])
  // Enrichment: a failed read names the rows by their short ids.
  const businessKeys = await optional(
    fetchBusinessKeys(
      client,
      raw.map((r) => r.processInstanceId),
    ),
  )
  return {
    processDefinitionKey: options.processDefinitionKey,
    activityId: options.activityId,
    incidents: raw.map((r) => toIncidentInstance(r, options, businessKeys)),
    totalCount,
  }
}
