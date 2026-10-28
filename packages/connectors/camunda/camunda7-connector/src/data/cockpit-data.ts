import {
  complementaryFlags,
  engineInstanceSearch,
  engineLike,
  trueOnly,
  type Client,
} from "@miragon/pulse-camunda7-client"
import type {
  CockpitDashboardData,
  DefinitionStat,
  JobPanelData,
  ProcessInstanceRow,
  ProcessInstancesData,
  ProcessListData,
} from "../view-models.js"
import {
  getProcessDefinitions,
  getProcessDefinitionsCount,
  getProcessInstances,
  getJobsCount,
  queryJobs,
  queryProcessInstances,
  queryProcessInstancesCount,
} from "@miragon/pulse-camunda7-client/sdk"
import type {
  InstanceSearchArgs,
  JobsFilters,
  PagingArgs,
  ProcessInstancesFilters,
  ProcessListFilters,
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
import { countOf, optional, rowsOf } from "./engine-reads.js"

/** One row per KEY, summed over every version; the statistics call's failure is the view's (no "0 instances"). */
export async function buildCockpitDashboardData(
  client: Client,
  engineId: string,
): Promise<CockpitDashboardData> {
  const statsByKey = await fetchStatsByKey(client, { failedJobs: true })

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
  // A Modeler pool around an unnamed process names it, as analytics names it.
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

export type ProcessListArgs = ProcessListFilters & PagingArgs

export async function buildProcessListData(
  client: Client,
  engineId: string,
  args: ProcessListArgs,
): Promise<ProcessListData> {
  const latestVersion = args.latestVersion ?? true
  const filters = {
    key: args.processDefinitionKey,
    nameLike: engineLike(args.nameLike),
    latestVersion: trueOnly(latestVersion),
  }
  const [definitions, totalCount] = await Promise.all([
    getProcessDefinitions({
      client,
      query: {
        ...filters,
        firstResult: Math.max(0, args.firstResult ?? 0),
        maxResults: args.maxResults ?? 50,
        sortBy: "name",
        sortOrder: "asc",
      },
    }).then((rows) => rowsOf<ProcessListData["definitions"][number]>(rows)),
    getProcessDefinitionsCount({ client, query: filters }).then(countOf),
  ])
  return {
    // A Modeler pool around an unnamed process names it, as analytics names it.
    definitions: await nameUnnamedDefinitions(client, definitions),
    totalCount,
    filters: {
      processDefinitionKey: args.processDefinitionKey,
      nameLike: args.nameLike,
      latestVersion,
    },
    engineId,
  }
}

export type ProcessInstancesArgs = ProcessInstancesFilters & InstanceSearchArgs & PagingArgs

// The engine IGNORES `false` for active/suspended/withIncident (HTTP 200, no
// filter), so a forwarded false would list every instance: active/suspended
// send the complement, withIncident only goes out as true. businessKeyLike
// needs `%`, or it matches exactly.
function toProcessInstanceFilter(args: ProcessInstancesArgs) {
  const { orQueries } = engineInstanceSearch(args.search)
  return {
    processDefinitionKey: args.processDefinitionKey,
    ...complementaryFlags(args, "active", "suspended"),
    withIncident: trueOnly(args.withIncidents),
    businessKeyLike: orQueries ? undefined : engineLike(args.businessKeyLike),
    orQueries,
  }
}

/**
 * The instance id breaks ties: most instances have no business key and the engine
 * adds no tie-break once a sort is given, so paging would repeat or skip rows.
 * Only the POST query takes two keys.
 */
const INSTANCE_LIST_ORDER = [
  { sortBy: "businessKey", sortOrder: "asc" },
  { sortBy: "instanceId", sortOrder: "asc" },
] as const

type ProcessInstanceFilter = ReturnType<typeof toProcessInstanceFilter>

interface RawInstance {
  id?: string | null
  definitionId?: string | null
  businessKey?: string | null
  suspended?: boolean | null
}

/** Totals over the WHOLE filtered set, never the page; a deciding filter answers without a call. */
function filteredTotals(client: Client, filter: ProcessInstanceFilter) {
  const count = (body: ProcessInstanceFilter) =>
    queryProcessInstancesCount({ client, body }).then(countOf)
  const total = count(filter)
  return Promise.all([
    total,
    filter.withIncident ? total : count({ ...filter, withIncident: true }),
    filter.suspended
      ? total
      : filter.active
        ? Promise.resolve(0)
        : count({ ...filter, suspended: true }),
  ])
}

/** Scoped to the page's ids, not an engine-wide incident scan. */
async function instancesWithIncident(
  client: Client,
  pageIds: string[],
  filter: ProcessInstanceFilter,
): Promise<Set<string>> {
  if (filter.withIncident || pageIds.length === 0) {
    return new Set(filter.withIncident ? pageIds : [])
  }
  const flagged = rowsOf<RawInstance>(
    await getProcessInstances({
      client,
      query: {
        processInstanceIds: pageIds.join(","),
        withIncident: true,
        maxResults: pageIds.length,
      },
    }),
  )
  return new Set(flagged.map((i) => i.id).filter((id): id is string => !!id))
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

export async function buildProcessInstancesData(
  client: Client,
  engineId: string,
  args: ProcessInstancesArgs,
): Promise<ProcessInstancesData> {
  const filter = toProcessInstanceFilter(args)

  const [raw, [totalCount, withIncidentCount, suspendedCount], definition] = await Promise.all([
    queryProcessInstances({
      client,
      query: { firstResult: args.firstResult ?? 0, maxResults: args.maxResults ?? 50 },
      body: { ...filter, sorting: [...INSTANCE_LIST_ORDER] },
    }).then((rows) => rowsOf<RawInstance>(rows)),
    filteredTotals(client, filter),
    // An unknown key is the engine's 404, not "0 running instances".
    args.processDefinitionKey
      ? fetchLatestDefinition(client, args.processDefinitionKey)
      : Promise.resolve(null),
  ])

  const page = raw.filter((i): i is RawInstance & { id: string } => !!i.id)
  const [flagged, keyOf, nameOf] = await Promise.all([
    instancesWithIncident(
      client,
      page.map((i) => i.id),
      filter,
    ),
    rowKeyResolver(client, page, args.processDefinitionKey),
    rowNameResolver(client, page, definition),
  ])
  const instances: ProcessInstanceRow[] = page.map((i) => ({
    id: i.id,
    businessKey: i.businessKey ?? null,
    processDefinitionKey: i.definitionId ? keyOf(i.definitionId) : null,
    processDefinitionName: i.definitionId ? nameOf(i.definitionId) : null,
    version: definitionVersionFromId(i.definitionId),
    suspended: i.suspended ?? false,
    hasIncident: flagged.has(i.id),
  }))

  return {
    processDefinitionKey: args.processDefinitionKey ?? null,
    processDefinitionName: definition?.name ?? null,
    totalCount,
    returnedCount: instances.length,
    withIncidentCount,
    suspendedCount,
    instances,
    filters: {
      active: args.active,
      suspended: args.suspended,
      withIncidents: args.withIncidents,
      ...(filter.orQueries
        ? { search: args.search?.trim() }
        : { businessKeyLike: args.businessKeyLike }),
    },
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

/** All three reads are primary: an unreachable engine is a tool error, never "0 jobs". */
export async function buildJobPanelData(
  client: Client,
  engineId: string,
  args: JobsFilters & PagingArgs,
): Promise<JobPanelData> {
  const baseQuery = { processDefinitionKey: args.processDefinitionKey }
  const [raw, failedCount, allCount] = await Promise.all([
    queryJobs({
      client,
      query: { firstResult: args.firstResult ?? 0, maxResults: args.maxResults ?? 50 },
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
    engineId,
  }
}
