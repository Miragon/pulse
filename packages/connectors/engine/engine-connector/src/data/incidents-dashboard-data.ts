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
  definitionKeyInId,
  elementNameIn,
  fetchNamesByDefinition,
  foldStatsByProcess,
  nameUnnamedDefinitions,
  unknownKeyError,
  type NamesByDefinition,
} from "./definition-info.js"
import { groupBy, scanFacts, scanIncidents, type IncidentRow } from "./incident-scan.js"
import { readStatistics } from "./statistics-floor.js"

export interface IncidentsDashboardOptions extends IncidentsDashboardFilters {
  baseUrl: string
  cockpitUrl?: string
  provider: EngineProvider
}

/** A card's process: its key in one tenant, its statistics over its versions there. */
type ProcessStats = ReturnType<typeof foldStatsByProcess>[number]

/** A process's id among the cards: its key and its tenant. */
const cardIdOf = ({ key, tenantId }: ProcessStats) => JSON.stringify([key, tenantId])

/**
 * The card a version's root incident joins, by the statistics' version ids: its process's. A
 * version missing from them (deployed since) joins the card of the key its id names where the key
 * is one process; else none ("").
 */
function cardResolver(processes: readonly ProcessStats[]): (definitionId: string) => string {
  const byVersion = new Map<string, string>()
  for (const process of processes) {
    for (const id of process.versionIds) byVersion.set(id, cardIdOf(process))
  }
  return (definitionId) => {
    const known = byVersion.get(definitionId)
    if (known !== undefined) return known
    const ofKey = processes.filter(({ key }) => key === definitionKeyInId(definitionId))
    return ofKey.length === 1 ? cardIdOf(ofKey[0]) : ""
  }
}

/**
 * The open ROOT incidents by process, a key in one tenant (owner decisions D2, amended on
 * 2026-11-19, and 2026-11-26): a call activity's copy of a called instance's incident counts where
 * it was raised, in the called process, never at the caller, and is never a row. Counts are exact
 * and process-wide from the definition statistics (`rootIncidents=true`, folded per process), the
 * total their sum; the scan's root incidents (`isRootIncident`, c7-core's one rule) only add the
 * per-activity breakdown and timestamps, so a process whose incidents lie beyond the scan keeps its
 * exact count (#335 N61). Rows join cards through the statistics' version ids (bare ids carry no
 * key), so a key in two tenants is two cards, each naming its tenant and opening its process.
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
  const [scan, { rows, readAt }] = await Promise.all([
    scanIncidents(client, filter),
    readStatistics(client),
  ])
  const processes = foldStatsByProcess(rows, options.incidentType)
  if (options.processDefinitionKey !== undefined && !processes.some(matchesKey(options))) {
    throw unknownKeyError(options.processDefinitionKey)
  }

  const roots = scan.rows.filter(isRootIncident)
  // A row whose version joins no card ("") is none of its rows.
  const cardOf = cardResolver(processes)
  const scannedByCard = groupBy(roots, (r) => cardOf(r.processDefinitionId))
  const shown = processes
    .filter((stats) => stats.incidentCount > 0 && matchesKey(options)(stats))
    .sort((a, b) => b.incidentCount - a.incidentCount)
  const cards = shown.map((stats) => {
    const scanned = scannedByCard.get(cardIdOf(stats)) ?? []
    return { stats, scanned, groups: activityGroups(scanned) }
  })
  const names = await namesOf(client, cards)
  const processesShown = cards.map((card) => toProcess(card, { options, names }))

  return {
    totalCount: processesShown.reduce((sum, p) => sum + p.incidentCount, 0),
    processCount: processesShown.length,
    affectedActivityCount: processesShown.every((p) => p.affectedActivityCount !== null)
      ? processesShown.reduce((sum, p) => sum + (p.affectedActivityCount ?? 0), 0)
      : null,
    latestIncident: latestEngineDate(roots.map((r) => r.incidentTimestamp)),
    processes: processesShown,
    filters: {
      processDefinitionKey: options.processDefinitionKey,
      incidentType: options.incidentType,
    },
    // The older read's time: the statistics may answer from this caller's floor (30 s).
    fetchedAt: new Date(Math.min(startedAt, readAt)).toISOString(),
    engineVendor: options.provider.branding.displayName,
  }
}

/** A card: its process's statistics, its scanned root incidents and their groups per activity. */
interface Card {
  stats: ProcessStats
  scanned: IncidentRow[]
  groups: IncidentRow[][]
}

/**
 * ENRICHMENT: a Modeler pool around an unnamed process names its card, as every view names it; an
 * activity is named in the diagram of its newest incident's version, the busiest cards first; a
 * diagram past the cap or unread leaves its activities' ids.
 */
async function namesOf(client: Client, cards: readonly Card[]): Promise<NamesByDefinition> {
  const newestRows = cards.flatMap((card) => card.groups).map((rows) => rows[0])
  const [, names] = await Promise.all([
    nameUnnamedDefinitions(
      client,
      cards.map((card) => card.stats.latest),
    ),
    fetchNamesByDefinition(
      client,
      newestRows.map((row) => row.processDefinitionId),
    ),
  ])
  return names
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

/** Whether a process is of the key the dashboard is filtered to (any without a filter). */
function matchesKey(options: IncidentsDashboardOptions) {
  return ({ key }: { key: string }) =>
    options.processDefinitionKey === undefined || key === options.processDefinitionKey
}

function toProcess(
  { stats, scanned, groups }: Card,
  ctx: { options: IncidentsDashboardOptions; names: NamesByDefinition },
): IncidentsDashboardProcess {
  // Complete only when the scan holds every root incident of the process (vs. the exact count), so
  // a card never reports confident zeros next to its N incidents.
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
    processDefinitionKey: stats.key,
    ...(stats.tenantId === null ? {} : { tenantId: stats.tenantId }),
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
      { key: stats.key, version: stats.latest.version, definitionId: stats.latest.id || null },
      { tab: "incidents" },
    ),
    activities,
  }
}
