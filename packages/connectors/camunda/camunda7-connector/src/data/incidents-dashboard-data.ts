import { latestEngineDate, toEngineDate, type Client } from "@miragon/pulse-camunda7-client"
import { getIncidentsCount } from "@miragon/pulse-camunda7-client/sdk"
import type {
  IncidentsDashboardActivity,
  IncidentsDashboardData,
  IncidentsDashboardProcess,
} from "../view-models.js"
import type { EngineProvider } from "../engine-provider.js"
import type { IncidentsDashboardFilters } from "../feed-contracts.js"
import { buildProcessCockpitUrl } from "../lib/cockpit-url.js"
import {
  definitionKeyResolver,
  fetchStatsByKey,
  nameUnnamedDefinitions,
  unknownKeyError,
  type KeyStats,
} from "./definition-info.js"
import { countOf, DAY_MS } from "./engine-reads.js"
import {
  groupBy,
  scanFacts,
  scanIncidents,
  type IncidentRow,
  type IncidentScan,
} from "./incident-scan.js"

export interface IncidentsDashboardOptions extends IncidentsDashboardFilters {
  baseUrl: string
  cockpitUrl?: string
  provider: EngineProvider
}

/**
 * Counts are exact and KEY-wide from `/incident/count` and the definition
 * statistics; the scan only adds the per-activity breakdown and timestamps, so a
 * process whose incidents lie beyond the scan keeps its exact count (#335 N61).
 * Rows join cards through the statistics' version ids (bare ids carry no key).
 */
export async function buildIncidentsDashboardData(
  client: Client,
  options: IncidentsDashboardOptions,
): Promise<IncidentsDashboardData> {
  const cutoffMs = Date.now() - DAY_MS
  const filter = {
    processDefinitionKeyIn: options.processDefinitionKey,
    incidentType: options.incidentType,
  }
  const [scan, totalCount, last24hCount, statsByKey] = await Promise.all([
    scanIncidents(client, filter),
    getIncidentsCount({ client, query: filter }).then(countOf),
    getIncidentsCount({
      client,
      query: { ...filter, incidentTimestampAfter: toEngineDate(new Date(cutoffMs)) },
    }).then(countOf),
    fetchStatsByKey(client, { incidentsForType: options.incidentType }),
  ])

  if (options.processDefinitionKey !== undefined && !statsByKey.has(options.processDefinitionKey)) {
    throw unknownKeyError(options.processDefinitionKey)
  }

  const keyOf = definitionKeyResolver(statsByKey)
  // A row whose key resolves to nothing ("") joins no card.
  const scannedByKey = groupBy(scan.rows, (r) => keyOf(r.processDefinitionId) ?? "")
  const shown = [...statsByKey.entries()]
    .filter(([key, stats]) => stats.incidentCount > 0 && matchesKey(key, options))
    .sort((a, b) => b[1].incidentCount - a[1].incidentCount)
  // A Modeler pool around an unnamed process names its card, as analytics names it.
  await nameUnnamedDefinitions(
    client,
    shown.map(([, stats]) => stats.latest),
  )
  const processes = shown.map(([key, stats]) =>
    toProcess(key, stats, scannedByKey.get(key) ?? [], { scan, cutoffMs, options }),
  )

  return {
    totalCount,
    processCount: processes.length,
    affectedActivityCount: processes.every((p) => p.affectedActivityCount !== null)
      ? processes.reduce((sum, p) => sum + (p.affectedActivityCount ?? 0), 0)
      : null,
    last24hCount,
    latestIncident: latestEngineDate(scan.rows.map((r) => r.incidentTimestamp)),
    processes,
    filters: {
      processDefinitionKey: options.processDefinitionKey,
      incidentType: options.incidentType,
    },
    engineVendor: options.provider.branding.displayName,
  }
}

function matchesKey(key: string, options: IncidentsDashboardOptions): boolean {
  return options.processDefinitionKey === undefined || key === options.processDefinitionKey
}

function toProcess(
  key: string,
  stats: KeyStats,
  scanned: IncidentRow[],
  ctx: { scan: IncidentScan; cutoffMs: number; options: IncidentsDashboardOptions },
): IncidentsDashboardProcess {
  // Complete only when the scan holds every incident of the key (vs. the exact
  // count), so a card never reports confident zeros next to its N incidents.
  const fullyScanned = scanned.length >= stats.incidentCount
  const facts = scanFacts(scanned, { fullyScanned, scan: ctx.scan, cutoffMs: ctx.cutoffMs })
  const activities: IncidentsDashboardActivity[] = [
    ...groupBy(scanned, (r) => r.activityId).entries(),
  ]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([activityId, rows]) => ({
      activityId,
      // No BPMN on the overview — the definition view resolves display names.
      activityName: null,
      scannedIncidentCount: rows.length,
      ...scanFacts(rows, { fullyScanned, scan: ctx.scan, cutoffMs: ctx.cutoffMs }),
    }))

  return {
    processDefinitionKey: key,
    processDefinitionName: stats.latest.name,
    latestVersion: stats.latest.version,
    runningInstances: stats.instances,
    incidentCount: stats.incidentCount,
    scannedIncidentCount: scanned.length,
    affectedActivityCount: fullyScanned ? activities.length : null,
    last24hCount: facts.last24hCount,
    latestIncident: facts.latestIncident,
    cockpitUrl: buildProcessCockpitUrl(
      ctx.options,
      { key, version: stats.latest.version, definitionId: stats.latest.id || null },
      { tab: "incidents" },
    ),
    activities,
  }
}
