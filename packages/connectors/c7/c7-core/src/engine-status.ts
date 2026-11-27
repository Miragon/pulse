/**
 * The status triage of one engine in one call. Round 1 loads version, statistics, incidents,
 * external tasks, jobs, tasks and batches in parallel, round 2 the root cause of each incident
 * group shown; the findings name their next step, and the status is the live verdict
 * (`engineVerdict`) over the open root incidents, the largest cause and the findings.
 */

import { EXECUTABLE } from "./conditions.js"
import { definitionStatisticsOf, definitionStatisticsQuery } from "./definition-statistics.js"
import { readable } from "./errors.js"
import { type EngineStatus, type Finding, findings } from "./findings.js"
import { incidentCause } from "./inspect.js"
import { type EnginePort, PARALLEL, type PlannedRequest, pageQuery, type Query } from "./port.js"
import { engineFormat } from "./dates.js"
import { amount, countOf, records, str } from "./records.js"
import { queryInput } from "./requests.js"
import { newestIncidents, newestIncidentsRequest } from "./status-incidents.js"
import {
  type DefinitionStatus,
  definitionStatus,
  type GroupedIncidents,
  type GroupStep,
  groupIncidents,
  type IncidentGroup,
  type JobStatus,
  jobStatus,
  type TopicStatus,
  topicStatus,
  unknownKeys,
} from "./status.js"
import { BATCH_REQUESTS, batchesCut, readBatches } from "./status-batches.js"
import { compact, mapLimit, omit } from "./util.js"
import {
  causeKeyOf,
  criticalIncidentsRule,
  DEFAULT_VERDICT_THRESHOLDS,
  engineVerdict,
  incidentsAtThreshold,
  type RootIncidentCounts,
  rootIncidentCounts,
  type VerdictThresholds,
} from "./verdict.js"

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
  /** When open incidents make the status critical; `DEFAULT_VERDICT_THRESHOLDS` when left out. */
  readonly thresholds?: VerdictThresholds
}

/** The options with their defaults applied. */
type Resolved = StatusOptions & {
  readonly staleAfterMs: number
  readonly maxGroups: number
  readonly thresholds: VerdictThresholds
}

function resolved(options: StatusOptions): Resolved {
  return {
    ...options,
    staleAfterMs: options.staleAfterMs ?? STALE_AFTER_MS,
    maxGroups: options.maxGroups ?? MAX_GROUPS,
    thresholds: options.thresholds ?? DEFAULT_VERDICT_THRESHOLDS,
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
  /**
   * The open root incidents the status judges (`rootIncidentCounts`): the definitions' in scope
   * (the statistics with `rootIncidents=true`) and those outside any process among the incidents
   * loaded, a lower bound of these where the list was cut.
   */
  readonly rootIncidentsTotal: number
  /** Every open incident in scope, from a count: a call activity's copy counts too. */
  readonly incidentsTotal: number
  /** The copies on calling instances among the incidents loaded. */
  readonly propagated: number
  readonly externalTasks: readonly TopicStatus[]
  readonly jobs: JobStatus
  readonly tasks: { readonly open: number }
  /** The running batches and those with failed jobs, both counted (`status-batches.ts`). */
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
  readonly batches?: readonly PlannedRequest[]
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
    statistics: request(
      "getProcessDefinitionStatistics",
      definitionStatisticsQuery({ failedJobs: true }),
    ),
    incidentCount: request("getIncidentsCount", filter),
    externalTaskCount: request("getExternalTasksCount", filter),
    taskCount: request("getTasksCount", filter),
    incidents: filter,
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
    ...compact({ batches: keyIn === undefined ? BATCH_REQUESTS : undefined }),
  }
}

/** The requests of round 1, as a preview shows them (lists with their first page). */
export function statusRequests(options: StatusOptions, now: number): PlannedRequest[] {
  const all = requests(resolved(options), now)
  return [
    all.version,
    all.statistics,
    newestIncidentsRequest(all.incidents),
    all.incidentCount,
    request("getExternalTasks", pageQuery(all.externalTasks, 0, PAGE)),
    all.externalTaskCount,
    ...all.jobCounts,
    ...all.staleJobs,
    all.taskCount,
    ...(all.batches ?? []),
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
    newestIncidents(port, all.incidents, LIST_CAP),
    value(port, all.incidentCount),
    port.list("getExternalTasks", all.externalTasks, LIST_CAP),
    value(port, all.externalTaskCount),
    counts(all.jobCounts),
    Promise.all(all.staleJobs.map(async (planned) => records(await value(port, planned)))),
    value(port, all.taskCount),
    all.batches === undefined ? undefined : readBatches(port),
  ])
  return {
    ...version,
    statistics: await readable(all.statistics.operationId, () =>
      definitionStatisticsOf(statistics),
    ),
    incidents,
    incidentCount: countOf(incidentCount),
    externalTasks,
    externalTaskCount: countOf(externalTaskCount),
    executableJobs: jobCounts.reduce((sum, count) => sum + count, 0),
    staleJobs: staleJobs.flat(),
    // a key's page that reached the cap may hide more overdue jobs, whatever the other keys hold
    staleJobsCut: staleJobs.some((page) => page.length >= STALE_JOBS),
    openTasks: countOf(openTasks),
    ...compact({ batches }),
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
  const batches = batchesCut(data.batches)
  if (batches !== undefined) notes.push(batches)
  if (groups > options.maxGroups)
    notes.push(`incident groups: ${options.maxGroups} of ${groups} shown`)
  return notes
}

/**
 * Round 2: the incident groups (without the failed jobs of batches, which BATCH_FAILURES reports)
 * and the root cause of each group shown.
 */
async function incidentGroups(port: EnginePort, data: RoundOne, options: Resolved) {
  const failedBatches = (data.batches?.failed ?? []).filter(
    (batch) => amount(batch, "failedJobs") > 0,
  )
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
 * What made the status critical, where the open root incidents (`rootIncidentCounts`: the
 * definitions' in scope and those outside any process loaded, a batch's failed job too) or their
 * largest cause over every definition, a copy at a call activity in none, reach the thresholds: the
 * INCIDENTS_CRITICAL input, its next step the cause's largest group's, else its incidents by type.
 */
function atThreshold(input: RootIncidentCounts, grouped: GroupedIncidents, options: Resolved) {
  if (!incidentsAtThreshold(input, options.thresholds)) return undefined
  const cause = input.largestCause
  const key = cause?.key
  const group = grouped.groups.find(
    (candidate) =>
      causeKeyOf({
        activityId: candidate.activityId,
        incidentType: candidate.type,
        incidentMessage: candidate.message,
      }).key === key,
  )
  const incidentType = cause?.incidentType ?? "failedJob"
  return {
    openRootIncidents: input.openRootIncidents,
    largestCause: input.largestCluster,
    ...compact({ cause }),
    rule: criticalIncidentsRule(options.thresholds),
    next: group?.next ?? { action: "listIncidentsOfType" as const, incidentType },
  }
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
  const definitions = definitionStatus(data.statistics, options.keys)
  const ofDefinitions = definitions.reduce((sum, definition) => sum + definition.incidents, 0)
  const counts = rootIncidentCounts(ofDefinitions, data.incidents.items)
  const list = findings({
    ...compact({ incidentsAtThreshold: atThreshold(counts, grouped, options) }),
    jobs,
    incidents,
    externalTasks,
    batches: data.batches?.failed ?? [],
    unknownKeys: unknownKeys(data.statistics, options.keys),
    staleAfterMs: options.staleAfterMs,
    now,
  })
  const notes = truncation(data, grouped.groups.length, options)
  return {
    engine: { version: data.version, latencyMs: data.latencyMs },
    status: engineVerdict({ ...counts, findings: list }, options.thresholds),
    findings: list,
    definitions,
    incidents,
    rootIncidentsTotal: counts.openRootIncidents,
    incidentsTotal: data.incidentCount,
    propagated: grouped.propagated,
    externalTasks,
    jobs,
    tasks: { open: data.openTasks },
    ...compact({
      batches:
        data.batches === undefined
          ? undefined
          : { running: data.batches.running, withFailures: data.batches.withFailures },
      truncated: notes.length > 0 ? notes : undefined,
    }),
  }
}
