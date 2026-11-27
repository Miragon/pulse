import type { Client } from "@miragon/pulse-c7-client"
import {
  complementaryFlags,
  countSearchedInstances,
  engineLike,
  type InstanceBodyFilters,
  type InstanceBodyReads,
  pageSearchedInstances,
  searchedInstances,
  withIncidentAmong,
  withIncidentBody,
} from "@miragon/pulse-c7-core"
import {
  LIST_PAGE_SIZE,
  type CockpitDashboardData,
  type DefinitionStat,
  type JobPanelData,
  type ProcessInstanceRow,
  type ProcessInstancesData,
} from "../view-models.js"
import {
  getJobsCount,
  queryHistoricProcessInstances,
  queryJobs,
} from "@miragon/pulse-c7-client/sdk"
import type {
  InstanceSearchArgs,
  JobsFilters,
  PagingArgs,
  ProcessInstancesFilters,
} from "../feed-contracts.js"
import {
  definitionKeyInId,
  definitionVersionFromId,
  elementNameIn,
  fetchDefinitionsById,
  fetchLatestDefinition,
  fetchNamesByDefinition,
  fetchStatsByKey,
  nameUnnamedDefinitions,
  processNameIn,
  resolveDefinitionKeys,
  type DefinitionInfo,
} from "./definition-info.js"
import { enginePortFor } from "../lib/core-adapter/engine-port.js"
import { countOf, optional, rowsOf } from "./engine-reads.js"
import { instanceReads, type RawInstance } from "./instance-list-reads.js"

/** One row per KEY, summed over every version; the statistics call's failure is the view's (no "0 instances"). */
export async function buildCockpitDashboardData(
  client: Client,
  engineId: string,
): Promise<CockpitDashboardData> {
  const statsByKey = await fetchStatsByKey(client)

  const definitions: DefinitionStat[] = [...statsByKey.entries()].map(([key, stats]) => ({
    id: stats.latest.id,
    key,
    name: stats.latest.name,
    latestVersion: stats.latest.version,
    instances: stats.instances,
    failedJobs: stats.failedJobs,
    incidents: [...stats.incidentsByType.entries()].map(([incidentType, incidentCount]) => ({
      incidentType,
      incidentCount,
    })),
  }))

  const issuesOf = (d: DefinitionStat) =>
    d.failedJobs + d.incidents.reduce((s, i) => s + i.incidentCount, 0)
  definitions.sort((a, b) => issuesOf(b) - issuesOf(a) || b.instances - a.instances)
  // A Modeler pool around an unnamed process names it, as every view names it.
  await nameUnnamedDefinitions(client, definitions)

  return {
    summary: {
      totalDefinitions: definitions.length,
      totalRunningInstances: definitions.reduce((s, d) => s + d.instances, 0),
      totalFailedJobs: definitions.reduce((s, d) => s + d.failedJobs, 0),
      totalIncidents: definitions.reduce(
        (s, d) => s + d.incidents.reduce((t, i) => t + i.incidentCount, 0),
        0,
      ),
    },
    definitions,
    engineId,
  }
}

export type ProcessInstancesArgs = ProcessInstancesFilters & InstanceSearchArgs & PagingArgs

// The engine IGNORES `false` for active/suspended/withIncident (HTTP 200, no
// filter), so a forwarded false would list every instance: active/suspended
// send the complement. businessKeyLike needs `%`, or it matches exactly. "With
// incident" is c7-core's one reading (with-incident.ts): the runtime's open
// incidents, on every history level, in the search body's form
// (`withIncidentBody`), which never sends a false flag. The search box joins
// these filters in c7-core's bodies only (`searchedInstances`, #717).
function toProcessInstanceFilter(args: ProcessInstancesArgs): InstanceBodyFilters {
  return {
    processDefinitionKey: args.processDefinitionKey,
    ...complementaryFlags(args, "active", "suspended"),
    ...withIncidentBody(args.withIncidents),
    businessKeyLike: engineLike(args.businessKeyLike),
  }
}

type InstanceReads = InstanceBodyReads<RawInstance>

/**
 * Totals over the WHOLE set, never the page: each chip's count (All, With incident, Suspended) on
 * the same scope and search whichever chip is on, and the page's total, which is the count of the
 * chip that is on and so costs no read of its own. Only both flags at once, which no chip sends,
 * read their intersection as a fourth count. `active` is no chip: it stays in the scope, where
 * nothing is suspended.
 */
async function filteredTotals(reads: InstanceReads, filter: InstanceBodyFilters, search?: string) {
  const count = (body: InstanceBodyFilters) =>
    countSearchedInstances(reads, searchedInstances(body, search))
  const scope = { ...filter, withIncident: undefined, suspended: undefined }
  const all = count(scope)
  const withIncident = count({ ...scope, ...withIncidentBody(true) })
  const suspended = filter.active ? Promise.resolve(0) : count({ ...scope, suspended: true })
  const total = filter.withIncident
    ? filter.suspended
      ? count(filter)
      : withIncident
    : filter.suspended
      ? suspended
      : all
  const [totalCount, allCount, withIncidentCount, suspendedCount] = await Promise.all([
    total,
    all,
    withIncident,
    suspended,
  ])
  return { totalCount, allCount, withIncidentCount, suspendedCount }
}

/**
 * Scoped to the page's ids, not an engine-wide incident scan: c7-core's flag of a listed instance
 * (`withIncidentAmong`), the one the editors' instance lists read too.
 */
async function instancesWithIncident(
  client: Client,
  pageIds: string[],
  filter: InstanceBodyFilters,
): Promise<ReadonlySet<string>> {
  if (filter.withIncident) return new Set(pageIds)
  return withIncidentAmong(enginePortFor(client), pageIds)
}

/** ENRICHMENT: a failed statistics read leaves bare-id keys null ("—", no drill), never a UUID. */
async function rowKeyResolver(
  client: Client,
  page: RawInstance[],
  scopedKey: string | undefined,
): Promise<(definitionId: string) => string | null> {
  if (scopedKey) return () => scopedKey
  const keys = resolveDefinitionKeys(
    client,
    page.map((i) => i.definitionId),
  )
  return (await optional(keys)) ?? definitionKeyInId
}

/** ENRICHMENT: a failed read leaves the names null; the rows then show their keys. */
async function rowNameResolver(
  client: Client,
  page: RawInstance[],
  scoped: DefinitionInfo | null,
): Promise<(definitionId: string) => string | null> {
  if (scoped) {
    await nameUnnamedDefinitions(client, [scoped])
    return () => scoped.name
  }
  const byId = await optional(
    fetchDefinitionsById(
      client,
      page.map((i) => i.definitionId),
    ),
  )
  if (byId) await nameUnnamedDefinitions(client, [...byId.values()])
  return (definitionId) => byId?.get(definitionId)?.name ?? null
}

/**
 * ENRICHMENT: when each instance of the page started, ONE history read over the page's ids. The
 * runtime's instance carries no start; a failed read, or an engine that records no history (level
 * NONE), leaves the starts null ("—"), never a guessed time.
 */
async function startTimesOf(
  client: Client,
  pageIds: string[],
): Promise<ReadonlyMap<string, string>> {
  if (pageIds.length === 0) return new Map()
  const rows = await optional(
    queryHistoricProcessInstances({
      client,
      query: { maxResults: pageIds.length },
      body: { processInstanceIds: pageIds },
    }).then((res) => rowsOf<{ id?: string | null; startTime?: string | null }>(res)),
  )
  return new Map(
    (rows ?? []).flatMap((row) => (row.id && row.startTime ? [[row.id, row.startTime]] : [])),
  )
}

export async function buildProcessInstancesData(
  client: Client,
  engineId: string,
  args: ProcessInstancesArgs,
): Promise<ProcessInstancesData> {
  const fetchedAt = new Date().toISOString()
  const filter = toProcessInstanceFilter(args)
  const reads = instanceReads(client)
  const searched = searchedInstances(filter, args.search)

  const [raw, totals, definition] = await Promise.all([
    pageSearchedInstances(reads, searched, {
      firstResult: args.firstResult ?? 0,
      maxResults: args.maxResults ?? LIST_PAGE_SIZE,
    }),
    filteredTotals(reads, filter, args.search),
    // An unknown key is the engine's 404, not "0 running instances".
    args.processDefinitionKey
      ? fetchLatestDefinition(client, args.processDefinitionKey)
      : Promise.resolve(null),
  ])

  const page = raw.filter((i): i is RawInstance & { id: string } => !!i.id)
  const pageIds = page.map((i) => i.id)
  const [flagged, keyOf, nameOf, startOf] = await Promise.all([
    instancesWithIncident(client, pageIds, filter),
    rowKeyResolver(client, page, args.processDefinitionKey),
    rowNameResolver(client, page, definition),
    startTimesOf(client, pageIds),
  ])
  const instances: ProcessInstanceRow[] = page.map((i) => ({
    id: i.id,
    businessKey: i.businessKey ?? null,
    processDefinitionKey: i.definitionId ? keyOf(i.definitionId) : null,
    processDefinitionName: i.definitionId ? nameOf(i.definitionId) : null,
    version: definitionVersionFromId(i.definitionId),
    suspended: i.suspended ?? false,
    hasIncident: flagged.has(i.id),
    startTime: startOf.get(i.id) ?? null,
  }))

  return {
    processDefinitionKey: args.processDefinitionKey ?? null,
    processDefinitionName: definition?.name ?? null,
    totalCount: totals.totalCount,
    returnedCount: instances.length,
    allCount: totals.allCount,
    withIncidentCount: totals.withIncidentCount,
    suspendedCount: totals.suspendedCount,
    instances,
    filters: {
      active: args.active,
      suspended: args.suspended,
      withIncidents: args.withIncidents,
      ...(searched.term === undefined
        ? { businessKeyLike: args.businessKeyLike }
        : { search: searched.term }),
    },
    fetchedAt,
    engineId,
  }
}

interface RawJob {
  id: string
  processInstanceId: string
  processDefinitionKey?: string | null
  processDefinitionId?: string | null
  failedActivityId?: string | null
  retries: number
  exceptionMessage?: string | null
  dueDate?: string | null
  suspended: boolean
  priority: number
  createTime?: string | null
}

/**
 * Jobs without retries first (what the panel is opened for), the job id as the
 * tie-break: retries alone is no total order and the engine adds none, so
 * paging would repeat or skip jobs. Only the POST query takes two keys.
 */
const JOB_PANEL_ORDER = [
  { sortBy: "jobRetries", sortOrder: "asc" },
  { sortBy: "jobId", sortOrder: "asc" },
] as const

/**
 * All three reads are primary: an unreachable engine is a tool error, never "0 jobs". Both counts
 * are read in either scope, so the view's segments count All and Without retries whichever lists.
 */
export async function buildJobPanelData(
  client: Client,
  engineId: string,
  args: JobsFilters & PagingArgs,
): Promise<JobPanelData> {
  const fetchedAt = new Date().toISOString()
  const baseQuery = { processDefinitionKey: args.processDefinitionKey }
  const [raw, failedCount, allCount] = await Promise.all([
    queryJobs({
      client,
      query: { firstResult: args.firstResult ?? 0, maxResults: args.maxResults ?? LIST_PAGE_SIZE },
      body: {
        ...baseQuery,
        noRetriesLeft: args.failedOnly ? true : undefined,
        sorting: [...JOB_PANEL_ORDER],
      },
    }).then((rows) => rowsOf<RawJob>(rows)),
    getJobsCount({ client, query: { ...baseQuery, noRetriesLeft: true } }).then(countOf),
    getJobsCount({ client, query: baseQuery }).then(countOf),
    // A scoped panel for an unknown key is the engine's 404, not "0 jobs".
    args.processDefinitionKey
      ? fetchLatestDefinition(client, args.processDefinitionKey)
      : Promise.resolve(null),
  ])

  // Names before ids (#322 U13); enrichment, ids stand in for unreadable diagrams.
  const names = await fetchNamesByDefinition(
    client,
    raw.map((j) => j.processDefinitionId),
  )

  return {
    totalCount: args.failedOnly ? failedCount : allCount,
    allCount,
    failedCount,
    jobs: raw.map((j) => ({
      id: j.id,
      processInstanceId: j.processInstanceId,
      processDefinitionKey: j.processDefinitionKey ?? null,
      processDefinitionId: j.processDefinitionId ?? null,
      processDefinitionName: processNameIn(names, j.processDefinitionId, j.processDefinitionKey),
      // The engine's job carries the activity it failed at, not an `activityId`.
      activityId: j.failedActivityId ?? null,
      activityName: elementNameIn(names, j.processDefinitionId, j.failedActivityId),
      retries: j.retries,
      exceptionMessage: j.exceptionMessage ?? null,
      dueDate: j.dueDate ?? null,
      suspended: j.suspended,
      priority: j.priority,
      createTime: j.createTime ?? null,
    })),
    filters: {
      processDefinitionKey: args.processDefinitionKey,
      failedOnly: args.failedOnly,
    },
    fetchedAt,
    engineId,
  }
}
