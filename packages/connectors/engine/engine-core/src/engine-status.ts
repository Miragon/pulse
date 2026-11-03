/**
 * The status triage of one engine in one call. Round 1 loads version, statistics, incidents,
 * external tasks, jobs, tasks and batches in parallel, round 2 the root cause of each incident
 * group shown; the findings name their next step.
 */

import { EXECUTABLE } from "./conditions.js"
import { type EngineStatus, type Finding, findings, engineStatus } from "./findings.js"
import { incidentCause } from "./inspect.js"
import { type EnginePort, PARALLEL, type PlannedRequest, pageQuery, type Query } from "./port.js"
import { engineFormat } from "./dates.js"
import { amount, countOf, type Rec, records, str } from "./records.js"
import { queryInput } from "./requests.js"
import {
  type DefinitionStatus,
  definitionStatus,
  type GroupStep,
  groupIncidents,
  type IncidentGroup,
  type JobStatus,
  jobStatus,
  type TopicStatus,
  topicStatus,
  unknownKeys,
} from "./status.js"
import { compact, mapLimit, omit } from "./util.js"

/** How long an executable job or a waiting external task may wait by default: 5 minutes. */
const STALE_AFTER_MS = 300_000
/** Incident groups shown (with their root cause) by default. */
const MAX_GROUPS = 10

export interface StatusOptions {
  /** Process definition keys to look at; empty for the whole engine. */
  readonly keys: readonly string[]
  /**
   * How long an executable job or a waiting external task may wait before it is a finding;
   * `STALE_AFTER_MS` when left out.
   */
  readonly staleAfterMs?: number
  /** Incident groups shown (with their root cause) at most; `MAX_GROUPS` when left out. */
  readonly maxGroups?: number
  /** The tie-break of equal incident groups; `defaultGroupOrder` when left out. */
  readonly compareGroupSteps?: (left: GroupStep, right: GroupStep) => number
}

/** The options with their defaults applied. */
type Resolved = StatusOptions & { readonly staleAfterMs: number; readonly maxGroups: number }

function resolved(options: StatusOptions): Resolved {
  return {
    ...options,
    staleAfterMs: options.staleAfterMs ?? STALE_AFTER_MS,
    maxGroups: options.maxGroups ?? MAX_GROUPS,
  }
}

/** The status of one engine; `next` steps structured, the engine without its address. */
export interface StatusData {
  readonly engine: {
    readonly version: string | null
    readonly latencyMs: number
  }
  readonly status: EngineStatus
  readonly findings: readonly Finding[]
  readonly definitions: readonly DefinitionStatus[]
  readonly incidents: readonly IncidentGroup[]
  readonly incidentsTotal: number
  readonly propagated: number
  readonly externalTasks: readonly TopicStatus[]
  readonly jobs: JobStatus
  readonly tasks: { readonly open: number }
  readonly batches?: { readonly running: number; readonly withFailures: number }
  readonly truncated?: readonly string[]
}

export interface StatusDeps {
  readonly port: EnginePort
  readonly now: () => number
}

/** Incidents and external tasks loaded at most. */
const LIST_CAP = 2000
const STALE_JOBS = 1000
const BATCHES = 100
const PAGE = 500

interface Requests {
  readonly version: PlannedRequest
  readonly statistics: PlannedRequest
  readonly incidentCount: PlannedRequest
  readonly externalTaskCount: PlannedRequest
  readonly taskCount: PlannedRequest
  readonly incidents: Query
  readonly externalTasks: Query
  readonly jobCounts: readonly PlannedRequest[]
  readonly staleJobs: readonly PlannedRequest[]
  readonly batches?: PlannedRequest
}

function request(operationId: string, query: Query = {}): PlannedRequest {
  return { operationId, input: queryInput(query) }
}

function requests(options: Resolved, now: number): Requests {
  const keyIn = options.keys.length > 0 ? options.keys.join(",") : undefined
  const filter = { processDefinitionKeyIn: keyIn }
  const perKey = options.keys.length > 0 ? options.keys : [undefined]
  const createTimes = `lt_${engineFormat(now - options.staleAfterMs)}`
  return {
    version: request("getRestAPIVersion"),
    statistics: request("getProcessDefinitionStatistics", {
      failedJobs: "true",
      rootIncidents: "true",
    }),
    incidentCount: request("getIncidentsCount", filter),
    externalTaskCount: request("getExternalTasksCount", filter),
    taskCount: request("getTasksCount", filter),
    incidents: { sortBy: "incidentTimestamp", sortOrder: "desc", ...filter },
    externalTasks: filter,
    jobCounts: perKey.map((key) =>
      request("getJobsCount", { ...EXECUTABLE, processDefinitionKey: key }),
    ),
    staleJobs: perKey.map((key) =>
      request("getJobs", {
        ...EXECUTABLE,
        createTimes,
        maxResults: String(STALE_JOBS),
        processDefinitionKey: key,
      }),
    ),
    ...compact({
      batches:
        keyIn === undefined
          ? request("getBatchStatistics", { maxResults: String(BATCHES) })
          : undefined,
    }),
  }
}

/** The requests of round 1, as a preview shows them (lists with their first page). */
export function statusRequests(options: StatusOptions, now: number): PlannedRequest[] {
  const all = requests(resolved(options), now)
  return [
    all.version,
    all.statistics,
    request("getIncidents", pageQuery(all.incidents, 0, PAGE)),
    all.incidentCount,
    request("getExternalTasks", pageQuery(all.externalTasks, 0, PAGE)),
    all.externalTaskCount,
    ...all.jobCounts,
    ...all.staleJobs,
    all.taskCount,
    ...(all.batches === undefined ? [] : [all.batches]),
  ]
}

async function value(port: EnginePort, planned: PlannedRequest): Promise<unknown> {
  return port.json(planned.operationId, planned.input)
}

async function timedVersion(deps: StatusDeps, planned: PlannedRequest) {
  const started = deps.now()
  const version = await value(deps.port, planned)
  return {
    version: str(records([version])[0], "version") ?? null,
    latencyMs: deps.now() - started,
  }
}

async function roundOne(deps: StatusDeps, all: Requests) {
  const { port } = deps
  const counts = (list: readonly PlannedRequest[]) =>
    Promise.all(list.map(async (planned) => countOf(await value(port, planned))))
  const [
    version,
    statistics,
    incidents,
    incidentCount,
    externalTasks,
    externalTaskCount,
    jobCounts,
    staleJobs,
    openTasks,
    batches,
  ] = await Promise.all([
    timedVersion(deps, all.version),
    value(port, all.statistics),
    port.list("getIncidents", all.incidents, LIST_CAP),
    value(port, all.incidentCount),
    port.list("getExternalTasks", all.externalTasks, LIST_CAP),
    value(port, all.externalTaskCount),
    counts(all.jobCounts),
    Promise.all(all.staleJobs.map(async (planned) => records(await value(port, planned)))),
    value(port, all.taskCount),
    all.batches === undefined ? undefined : value(port, all.batches),
  ])
  return {
    ...version,
    statistics: records(statistics),
    incidents,
    incidentCount: countOf(incidentCount),
    externalTasks,
    externalTaskCount: countOf(externalTaskCount),
    executableJobs: jobCounts.reduce((sum, count) => sum + count, 0),
    staleJobs: staleJobs.flat(),
    // a key's page that reached the cap may hide more overdue jobs, whatever the other keys hold
    staleJobsCut: staleJobs.some((page) => page.length >= STALE_JOBS),
    openTasks: countOf(openTasks),
    ...compact({ batches: batches === undefined ? undefined : records(batches) }),
  }
}

type RoundOne = Awaited<ReturnType<typeof roundOne>>

function truncation(data: RoundOne, groups: number, options: Resolved): string[] {
  const notes: string[] = []
  if (data.incidents.truncated)
    notes.push(`incidents: ${data.incidents.items.length} of ${data.incidentCount} loaded`)
  if (data.externalTasks.truncated)
    notes.push(
      `externalTasks: ${data.externalTasks.items.length} of ${data.externalTaskCount} loaded`,
    )
  if (data.staleJobsCut) notes.push(`jobs: the first ${STALE_JOBS} overdue candidates loaded`)
  if (groups > options.maxGroups)
    notes.push(`incident groups: ${options.maxGroups} of ${groups} shown`)
  return notes
}

/**
 * Round 2: the incident groups (without the failed jobs of batches, which BATCH_FAILURES reports)
 * and the root cause of each group shown.
 */
async function incidentGroups(port: EnginePort, data: RoundOne, options: Resolved) {
  const failedBatches = (data.batches ?? []).filter((batch) => amount(batch, "failedJobs") > 0)
  const grouped = groupIncidents(
    data.incidents.items,
    data.statistics,
    new Set(failedBatches.flatMap((batch) => str(batch, "batchJobDefinitionId") ?? [])),
    options.compareGroupSteps,
  )
  const shown = grouped.groups.slice(0, options.maxGroups)
  const causes = await mapLimit(shown, PARALLEL, (group) =>
    incidentCause(port, group.newest, false),
  )
  const incidents = shown.map((group, index) => ({
    ...omit(group, "newest"),
    ...compact({ rootCause: causes[index]?.rootCause }),
  }))
  return { grouped, incidents }
}

/**
 * The status of the engine behind `deps.port`: findings with their severity, the overall status,
 * definitions, incident groups with their root cause, topics, jobs, tasks and batches; every cut
 * named in `truncated`. Reads `deps.now` once at the start and twice around the version request.
 */
export async function readStatus(
  deps: StatusDeps,
  statusOptions: StatusOptions,
): Promise<StatusData> {
  const options = resolved(statusOptions)
  const now = deps.now()
  const data = await roundOne(deps, requests(options, now))
  const { grouped, incidents } = await incidentGroups(deps.port, data, options)
  const externalTasks = topicStatus(data.externalTasks.items, now)
  const jobs = jobStatus(data.executableJobs, data.staleJobs, now - options.staleAfterMs)
  const batches = data.batches ?? []
  const list = findings({
    jobs,
    incidents,
    externalTasks,
    batches,
    unknownKeys: unknownKeys(data.statistics, options.keys),
    staleAfterMs: options.staleAfterMs,
    now,
  })
  const notes = truncation(data, grouped.groups.length, options)
  return {
    engine: { version: data.version, latencyMs: data.latencyMs },
    status: engineStatus(list),
    findings: list,
    definitions: definitionStatus(data.statistics, options.keys),
    incidents,
    incidentsTotal: data.incidentCount,
    propagated: grouped.propagated,
    externalTasks,
    jobs,
    tasks: { open: data.openTasks },
    ...compact({
      batches:
        data.batches === undefined
          ? undefined
          : {
              running: batches.length,
              withFailures: batches.filter((batch: Rec) => amount(batch, "failedJobs") > 0).length,
            },
      truncated: notes.length > 0 ? notes : undefined,
    }),
  }
}
