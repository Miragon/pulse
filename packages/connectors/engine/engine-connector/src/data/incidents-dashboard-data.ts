import type { Client } from "@miragon/pulse-c7-client"
import { elementOfActivity, isRootIncident, latestEngineDate } from "@miragon/pulse-c7-core"
import type {
  IncidentsDashboardActivity,
  IncidentsDashboardData,
  IncidentsDashboardProcess,
} from "../view-models.js"
import type { EngineProvider } from "../engine-provider.js"
import type { IncidentsDashboardFilters } from "../feed-contracts.js"
import { buildProcessCockpitUrl } from "../lib/engine/cockpit-url.js"
import {
  definitionKeyResolver,
  elementNameIn,
  fetchNamesByDefinition,
  fetchStatsRead,
  nameUnnamedDefinitions,
  unknownKeyError,
  type KeyStats,
  type NamesByDefinition,
} from "./definition-info.js"
import { groupBy, scanFacts, scanIncidents, type IncidentRow } from "./incident-scan.js"

export interface IncidentsDashboardOptions extends IncidentsDashboardFilters {
  baseUrl: string
  cockpitUrl?: string
  provider: EngineProvider
}

/**
 * The open ROOT incidents by process (owner decision D2, amended on 2026-11-19): a call activity's
 * copy of a called instance's incident counts where it was raised, in the called process, never at
 * the caller, and is never a row. Counts are exact and KEY-wide from the definition statistics
 * (`rootIncidents=true`), the total their sum; the scan's root incidents (`isRootIncident`, c7-core's
 * one rule) only add the per-activity breakdown and timestamps, so a process whose incidents lie
 * beyond the scan keeps its exact count (#335 N61). Rows join cards through the statistics'
 * version ids (bare ids carry no key).
 */
export async function buildIncidentsDashboardData(
  client: Client,
  options: IncidentsDashboardOptions,
): Promise<IncidentsDashboardData> {
  const startedAt = Date.now()
  const filter = {
    processDefinitionKeyIn: options.processDefinitionKey,
    incidentType: options.incidentType,
  }
  const [scan, { statsByKey, readAt }] = await Promise.all([
    scanIncidents(client, filter),
    fetchStatsRead(client, { incidentType: options.incidentType }),
  ])

  if (options.processDefinitionKey !== undefined && !statsByKey.has(options.processDefinitionKey)) {
    throw unknownKeyError(options.processDefinitionKey)
  }

  const keyOf = definitionKeyResolver(statsByKey)
  const roots = scan.rows.filter(isRootIncident)
  // A row whose key resolves to nothing ("") joins no card.
  const scannedByKey = groupBy(roots, (r) => keyOf(r.processDefinitionId) ?? "")
  const shown = [...statsByKey.entries()]
    .filter(([key, stats]) => stats.incidentCount > 0 && matchesKey(key, options))
    .sort((a, b) => b[1].incidentCount - a[1].incidentCount)
  const groupsByKey = new Map(
    shown.map(([key]) => [key, activityGroups(scannedByKey.get(key) ?? [])] as const),
  )
  const newestRows = [...groupsByKey.values()].flat().map((rows) => rows[0])
  const [, names] = await Promise.all([
    // A Modeler pool around an unnamed process names its card, as every view names it.
    nameUnnamedDefinitions(
      client,
      shown.map(([, stats]) => stats.latest),
    ),
    // ENRICHMENT: an activity is named in the diagram of its newest incident's version, the
    // busiest cards first; a diagram past the cap or unread leaves its activities' ids.
    fetchNamesByDefinition(
      client,
      newestRows.map((row) => row.processDefinitionId),
    ),
  ])
  const ctx = { options, names }
  const processes = shown.map(([key, stats]) =>
    toProcess(key, stats, scannedByKey.get(key) ?? [], groupsByKey.get(key) ?? [], ctx),
  )

  return {
    totalCount: processes.reduce((sum, p) => sum + p.incidentCount, 0),
    processCount: processes.length,
    affectedActivityCount: processes.every((p) => p.affectedActivityCount !== null)
      ? processes.reduce((sum, p) => sum + (p.affectedActivityCount ?? 0), 0)
      : null,
    latestIncident: latestEngineDate(roots.map((r) => r.incidentTimestamp)),
    processes,
    filters: {
      processDefinitionKey: options.processDefinitionKey,
      incidentType: options.incidentType,
    },
    // The older read's time: the statistics may answer from this caller's floor (30 s).
    fetchedAt: new Date(Math.min(startedAt, readAt)).toISOString(),
    engineVendor: options.provider.branding.displayName,
  }
}

/**
 * A card's root incidents by activity and incident type, the scope of the cluster a row opens, the
 * most incidents first; each group's rows newest first, as the scan reads them. The activity is the
 * engine's id the cluster reads and its fix's jobs are found by, so a multi-instance body's
 * incidents (`<id>#multiInstanceBody`, its own job and its own failure) are a row of their own,
 * named by the activity it repeats (`elementNameIn`).
 */
function activityGroups(scanned: IncidentRow[]): IncidentRow[][] {
  return [...groupBy(scanned, (r) => `${r.activityId} ${r.incidentType}`).values()].sort(
    (a, b) => b.length - a.length,
  )
}

function matchesKey(key: string, options: IncidentsDashboardOptions): boolean {
  return options.processDefinitionKey === undefined || key === options.processDefinitionKey
}

function toProcess(
  key: string,
  stats: KeyStats,
  scanned: IncidentRow[],
  groups: IncidentRow[][],
  ctx: { options: IncidentsDashboardOptions; names: NamesByDefinition },
): IncidentsDashboardProcess {
  // Complete only when the scan holds every root incident of the key (vs. the exact count), so a
  // card never reports confident zeros next to its N incidents.
  const fullyScanned = scanned.length >= stats.incidentCount
  const facts = scanFacts(scanned, { fullyScanned })
  const activities: IncidentsDashboardActivity[] = groups.map((rows) => {
    const [newest] = rows
    return {
      activityId: newest.activityId,
      incidentType: newest.incidentType,
      activityName: elementNameIn(ctx.names, newest.processDefinitionId, newest.activityId),
      scannedIncidentCount: rows.length,
      ...scanFacts(rows, { fullyScanned }),
    }
  })

  return {
    processDefinitionKey: key,
    processDefinitionName: stats.latest.name,
    latestVersion: stats.latest.version,
    runningInstances: stats.instances,
    incidentCount: stats.incidentCount,
    scannedIncidentCount: scanned.length,
    // Elements of the diagram, not their incident types: an activity failing two ways is one, and
    // so is one failing at its multi-instance body and its items (`elementOfActivity`).
    affectedActivityCount: fullyScanned
      ? new Set(activities.map((a) => elementOfActivity(a.activityId))).size
      : null,
    latestIncident: facts.latestIncident,
    cockpitUrl: buildProcessCockpitUrl(
      ctx.options,
      { key, version: stats.latest.version, definitionId: stats.latest.id || null },
      { tab: "incidents" },
    ),
    activities,
  }
}
