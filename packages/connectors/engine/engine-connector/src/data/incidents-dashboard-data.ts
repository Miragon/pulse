import type { Client } from "@miragon/pulse-c7-client"
import {
  causeKeyOf,
  isRootIncident,
  latestEngineDate,
  rootIdOfCopy,
  toEngineDate,
} from "@miragon/pulse-c7-core"
import { getIncidentsCount } from "@miragon/pulse-c7-client/sdk"
import type {
  IncidentCauseScope,
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
  fetchStatsByKey,
  nameUnnamedDefinitions,
  unknownKeyError,
  type KeyStats,
  type NamesByDefinition,
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
  const fetchedAt = new Date().toISOString()
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
  const groupsByKey = new Map(
    shown.map(([key]) => [key, activityGroups(scannedByKey.get(key) ?? [])] as const),
  )
  const newestRows = [...groupsByKey.values()].flat().map((rows) => rows[0])
  const rootOf = rootIncidentsIn(scan.rows)
  const [, names] = await Promise.all([
    // A Modeler pool around an unnamed process names its card, as every view names it.
    nameUnnamedDefinitions(
      client,
      shown.map(([, stats]) => stats.latest),
    ),
    // ENRICHMENT: an activity is named in the diagram of its newest incident's version, the
    // busiest cards first, then the root causes delegated rows stand for; a diagram past the cap or
    // unread leaves its activities' ids.
    fetchNamesByDefinition(client, [
      ...newestRows.map((row) => row.processDefinitionId),
      ...newestRows.map((row) => rootOf(row)?.processDefinitionId),
    ]),
  ])
  const ctx = { scan, cutoffMs, options, names, rootOf }
  const processes = shown.map(([key, stats]) =>
    toProcess(key, stats, scannedByKey.get(key) ?? [], groupsByKey.get(key) ?? [], ctx),
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
    fetchedAt,
    engineVendor: options.provider.branding.displayName,
  }
}

/**
 * A card's rows by activity and incident type, the scope of the cluster a root's row opens (a
 * delegated row opens its root cause's, `rowCause`), the most incidents first; each group's rows
 * newest first, as the scan reads them.
 */
function activityGroups(scanned: IncidentRow[]): IncidentRow[][] {
  return [...groupBy(scanned, (r) => `${r.activityId} ${r.incidentType}`).values()].sort(
    (a, b) => b.length - a.length,
  )
}

/**
 * The root incident a delegated incident stands for (a call activity's copy of a called instance's
 * failure), only where the scan holds it: no read of its own. Null for a root incident.
 */
function rootIncidentsIn(rows: IncidentRow[]): (row: IncidentRow) => IncidentRow | null {
  const byId = new Map(rows.map((r) => [r.id, r]))
  return (row) => {
    const rootId = rootIdOfCopy(row)
    return rootId === undefined ? null : (byId.get(rootId) ?? null)
  }
}

/**
 * Where a row leads and what it says, by its newest incident: a root's row opens its own cluster
 * and says its own message. A delegated row (a call activity's incident carries no message of its
 * own, its root cause in the called instance does) says its root cause's message and opens that
 * cause's cluster, as the overview's causes form it (`causeKeyOf`), where the scan holds the root:
 * never its own cluster, which lists root incidents alone and so none of its copies. Nothing rather
 * than the activity's id again.
 */
function rowCause(
  newest: IncidentRow,
  ctx: { names: NamesByDefinition; rootOf: (row: IncidentRow) => IncidentRow | null },
): Pick<IncidentsDashboardActivity, "representativeMessage" | "delegated" | "rootCause"> {
  if (isRootIncident(newest)) {
    return {
      representativeMessage: newest.incidentMessage || null,
      delegated: false,
      rootCause: null,
    }
  }
  const root = ctx.rootOf(newest)
  return {
    representativeMessage: newest.incidentMessage || (root?.incidentMessage ?? null),
    delegated: true,
    rootCause: root ? causeScope(root, ctx.names) : null,
  }
}

function causeScope(root: IncidentRow, names: NamesByDefinition): IncidentCauseScope {
  const { activityId, incidentType, signature } = causeKeyOf(root)
  return {
    activityId,
    incidentType,
    messageSignature: signature,
    activityName: elementNameIn(names, root.processDefinitionId, root.activityId),
  }
}

function matchesKey(key: string, options: IncidentsDashboardOptions): boolean {
  return options.processDefinitionKey === undefined || key === options.processDefinitionKey
}

function toProcess(
  key: string,
  stats: KeyStats,
  scanned: IncidentRow[],
  groups: IncidentRow[][],
  ctx: {
    scan: IncidentScan
    cutoffMs: number
    options: IncidentsDashboardOptions
    names: NamesByDefinition
    rootOf: (row: IncidentRow) => IncidentRow | null
  },
): IncidentsDashboardProcess {
  // Complete only when the scan holds every incident of the key (vs. the exact
  // count), so a card never reports confident zeros next to its N incidents.
  const fullyScanned = scanned.length >= stats.incidentCount
  const facts = scanFacts(scanned, { fullyScanned, scan: ctx.scan, cutoffMs: ctx.cutoffMs })
  const activities: IncidentsDashboardActivity[] = groups.map((rows) => {
    const [newest] = rows
    return {
      activityId: newest.activityId,
      incidentType: newest.incidentType,
      activityName: elementNameIn(ctx.names, newest.processDefinitionId, newest.activityId),
      scannedIncidentCount: rows.length,
      ...scanFacts(rows, { fullyScanned, scan: ctx.scan, cutoffMs: ctx.cutoffMs }),
      ...rowCause(newest, ctx),
    }
  })

  return {
    processDefinitionKey: key,
    processDefinitionName: stats.latest.name,
    latestVersion: stats.latest.version,
    runningInstances: stats.instances,
    incidentCount: stats.incidentCount,
    scannedIncidentCount: scanned.length,
    // Activities, not their incident types: an activity failing two ways is one.
    affectedActivityCount: fullyScanned ? new Set(activities.map((a) => a.activityId)).size : null,
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
