import type { Client } from "@miragon/pulse-c7-client"
import {
  type DefinitionStatisticsRow,
  elementOfActivity,
  isRootIncident,
  latestEngineDate,
  type TenantQuery,
  tenantQuery,
} from "@miragon/pulse-c7-core"
import { getJobsCount, getProcessInstancesCount } from "@miragon/pulse-c7-client/sdk"
import { bpmnProcessNameOf, readBpmnNames } from "@miragon/pulse-widget-shell/server"
import type {
  IncidentsByProcess,
  ProcessIncidentsActivity,
  ProcessIncidentsData,
} from "../view-models.js"
import type { EngineProvider } from "../engine-provider.js"
import { buildProcessCockpitUrl } from "../lib/engine/cockpit-url.js"
import { bpmnActivityIds } from "../lib/bpmn/bpmn-parse.js"
import {
  type CockpitProcess,
  holds,
  readCockpitProcess,
  scanOfProcess,
  statsOfProcess,
} from "./cockpit-process.js"
import {
  fetchDefinitionXml,
  foldStatsByProcess,
  nameUnnamedDefinitions,
  type KeyStats,
} from "./definition-info.js"
import { readElementCounts } from "./element-counts.js"
import { countOf, optional } from "./engine-reads.js"
import { readStatistics } from "./statistics-floor.js"
import { groupBy, scanFacts, type IncidentRow, type IncidentScan } from "./incident-scan.js"

/**
 * The running instances of a key, every version, as the process detail counts them: one count,
 * which `engine_process_stats` reads too; of one tenant's (`tenantQuery`) where one is named.
 */
export function countRunningInstances(
  client: Client,
  key: string,
  tenant?: TenantQuery,
): Promise<number> {
  return getProcessInstancesCount({ client, query: { processDefinitionKey: key, ...tenant } }).then(
    countOf,
  )
}

/**
 * The jobs of a key whose retries are used up, every version, as the process detail counts them;
 * of one tenant's (`tenantQuery`) where one is named.
 */
export function countFailedJobs(
  client: Client,
  key: string,
  tenant?: TenantQuery,
): Promise<number> {
  return getJobsCount({
    client,
    query: { processDefinitionKey: key, noRetriesLeft: true, ...tenant },
  }).then(countOf)
}

export interface ProcessIncidentsOptions {
  baseUrl: string
  cockpitUrl?: string
  provider: EngineProvider
  processDefinitionKey: string
  /** The process's tenant; without it the process the key names (`readCockpitProcess`). */
  tenantId?: string
}

/** Its running instances and its jobs without retries: the key's, of its tenant where not alone. */
function countsOf(client: Client, process: CockpitProcess): Promise<[number, number]> {
  const tenant = process.alone ? undefined : tenantQuery(process.tenantId)
  return Promise.all([
    countRunningInstances(client, process.key, tenant),
    countFailedJobs(client, process.key, tenant),
  ])
}

/** The root incidents of the process's scan and its counts per element of the diagram. */
async function incidentsOf(
  client: Client,
  process: CockpitProcess,
  stats: KeyStats | undefined,
): Promise<{ roots: IncidentRow[]; counts: Map<string, number> }> {
  const scan = await scanOfProcess(client, process, stats)
  const roots = scan.rows.filter(isRootIncident)
  return { roots, counts: await activityIncidentCounts(client, { scan, roots, stats }) }
}

/**
 * One PROCESS, a key in one tenant (`readCockpitProcess`), version-wide (#335 N60): old versions
 * keep running after a redeploy, so every number covers every version of the process; only the
 * diagram is one version, its latest. Its incidents are its open ROOT incidents (owner decision D2,
 * amended on 2026-11-19): the definition statistics' (`rootIncidents=true`), and per activity the
 * scan's root incidents (`isRootIncident`) where the scan holds every incident of the process, else
 * each root-carrying version's element statistics, read as the shared process screen reads them.
 * A call activity's copy of a called instance's incident counts in the called process, and a
 * multi-instance body's on the activity it repeats (`elementOfActivity`), the element of the
 * diagram, as the element statistics count it. Where the key is deployed in the process's tenant
 * alone, every read is the key's, as it always was; else the counts narrow to the tenant
 * (`tenantQuery`), the statistics to the process's versions and the scan to those that hold a root
 * incident (`scanOfProcess`), read after the statistics name them.
 */
export async function buildProcessIncidentsData(
  client: Client,
  options: ProcessIncidentsOptions,
): Promise<ProcessIncidentsData> {
  const key = options.processDefinitionKey
  const nowMs = Date.now()
  const [process, { rows: statistics, readAt }] = await Promise.all([
    // Primary: an unknown key or tenant is a not-found error, never a view of zeros.
    readCockpitProcess(client, key, options.tenantId),
    readStatistics(client),
  ])

  const definition = process.latest
  const stats = statsOfProcess(statistics, process)
  const incidentCount = stats?.incidentCount ?? 0
  const [[runningInstances, failedJobs], bpmnXml, { roots, counts }, siblingsWithIncidents] =
    await Promise.all([
      countsOf(client, process),
      optional(fetchDefinitionXml(client, definition.id)),
      incidentsOf(client, process, stats),
      // For the empty state alone; null otherwise, never an unread `[]`.
      incidentCount === 0
        ? siblingsWithIncidentsOf(client, statistics, process)
        : Promise.resolve(null),
    ])

  const diagramNames = readBpmnNames(bpmnXml ?? "")
  const activities = toActivities(counts, roots, diagramNames.elements)
  return {
    ...identityOf(process),
    // The engine's name, else the diagram's (a Modeler pool around an unnamed process).
    processDefinitionName: definition.name ?? bpmnProcessNameOf(diagramNames, key),
    diagramVersion: definition.version,
    diagramDefinitionId: bpmnXml ? definition.id : null,
    cockpitUrl: buildProcessCockpitUrl(
      options,
      { key, version: definition.version, definitionId: definition.id },
      { tab: "incidents" },
    ),
    runningInstances,
    incidentCount,
    failedJobs,
    ...diagramScopeOf(bpmnXml, activities),
    latestIncident: latestEngineDate(roots.map((r) => r.incidentTimestamp)),
    activities,
    siblingsWithIncidents,
    // The older read's time: the statistics may answer from this caller's floor (30 s).
    fetchedAt: new Date(Math.min(nowMs, readAt)).toISOString(),
    engineVendor: options.provider.branding.displayName,
  }
}

/** The process as the payload names it: its key, its tenant and its key's sharing, where it has them. */
function identityOf(process: CockpitProcess) {
  return {
    processDefinitionKey: process.key,
    ...(process.tenantId === null ? {} : { tenantId: process.tenantId }),
    ...(process.alone ? {} : { sharesKey: true as const }),
  }
}

/**
 * The diagram's activities and how many of them hold an incident; null where it is unread. Same
 * scope as the denominator: an activity only an older version has stays out of "X of the
 * diagram's Y".
 */
function diagramScopeOf(bpmnXml: string | null, activities: ProcessIncidentsActivity[]) {
  const diagramIds = bpmnXml ? new Set(bpmnActivityIds(bpmnXml)) : null
  return {
    totalActivityCount: diagramIds ? diagramIds.size : null,
    affectedDiagramActivityCount: diagramIds
      ? activities.filter((a) => diagramIds.has(a.activityId)).length
      : null,
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
 * The open root incidents per element of the diagram, the count of each group and of an activity's
 * page with more (`activity-incidents-data.ts`): a complete scan already holds every incident of
 * the process, so its root incidents are exact, a multi-instance body's on its activity; otherwise
 * each version that holds a root incident is read by the shared process screen's rule
 * (`readElementCounts`: its statistics with every incident at an element, the body's on its
 * activity, and the incidents at its call activities whole).
 */
export async function activityIncidentCounts(
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

/**
 * The other processes with open root incidents, each a key in one tenant (the fold per process),
 * the most first, from the statistics read.
 */
async function siblingsWithIncidentsOf(
  client: Client,
  statistics: readonly DefinitionStatisticsRow[],
  process: CockpitProcess,
): Promise<IncidentsByProcess[]> {
  const siblings = foldStatsByProcess(statistics)
    .filter((stats) => !holds(process, stats) && stats.incidentCount > 0)
    .sort((a, b) => b.incidentCount - a.incidentCount)
  // A Modeler pool around an unnamed process names it, as every view names it (enrichment).
  await nameUnnamedDefinitions(
    client,
    siblings.map((stats) => stats.latest),
  )
  return siblings.map((stats) => ({
    processDefinitionKey: stats.key,
    ...(stats.tenantId === null ? {} : { tenantId: stats.tenantId }),
    processDefinitionName: stats.latest.name,
    incidentCount: stats.incidentCount,
  }))
}
