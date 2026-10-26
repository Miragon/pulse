/**
 * Waiting for a process instance, shared by `wait` and the `--wait` of
 * advance, retry and deploy: poll until a condition holds, fail fast on incidents, then load the
 * instance view (the state at the end, also for the errors of exit code 9).
 */

import type { EnginePort } from "../engine-port/engine-port.js"
import type { PulseCliError } from "../errors.js"
import { formatDuration } from "../operation/durations.js"
import { compact, omit } from "../util.js"
import {
  type Condition,
  conditionLabel,
  decide,
  EXECUTABLE,
  measure,
  type Probe,
  type Verdict,
} from "./conditions.js"
import { listByIds } from "./engine.js"
import { type InspectOptions, instanceMissing, loadView } from "./inspect.js"
import { executeJob } from "./jobs.js"
import {
  endedError,
  incidentError,
  type JobFailure,
  jobFailedError,
  timeoutError,
} from "./outcomes.js"
import { poll } from "./poll.js"
import { compareTime, engineTime, field, records, str } from "./records.js"
import { activeTree } from "./tree.js"
import type { EndedInstance, InstanceView, WaitState } from "./types.js"

export interface WaitSettings {
  readonly conditions: readonly Condition[]
  readonly timeoutMs: number
  readonly failOnIncident: boolean
  /** `wait --execute-jobs`: execute due jobs of the tree on every poll that does not succeed. */
  readonly executeJobs: boolean
}

export interface WaitDeps {
  readonly port: EnginePort
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
  /** A progress line for a human at a terminal (stderr); absent when nobody watches. */
  readonly notice?: (line: string) => void
}

/** The line shown once when a wait has to sleep. */
export function waitingNotice(until: string, timeoutMs: number): string {
  return `Waiting until ${until} (up to ${formatDuration(timeoutMs)}; Ctrl-C to stop)...`
}

/** What one poll found out about the instance. */
interface Seen {
  readonly probe: Probe
  /** End state from the history; `ENDED` without a history record. */
  readonly state?: string
  readonly historyMissing: boolean
}

type Ending =
  | { readonly kind: "held"; readonly until: string }
  | { readonly kind: "incident" }
  | { readonly kind: "ended" }
  | { readonly kind: "job-failed"; readonly failure: JobFailure }

/** Jobs `--execute-jobs` runs per poll. */
const DUE_JOBS = 10

function idInput(id: string) {
  return { pathArgs: [id], query: {} }
}

/**
 * The instance as a poll sees it. An id unknown to runtime and history on the first poll is
 * NOT_FOUND; later it means the instance ended without a history record.
 */
async function look(port: EnginePort, id: string, first: boolean): Promise<Seen> {
  const runtime = records([await port.find("getProcessInstance", idInput(id))])[0]
  if (runtime !== undefined) {
    const tree = await activeTree(port, runtime)
    const nodes = tree.nodes.map((node) => node.id)
    const probe = { id, ended: false, tree: nodes, truncated: tree.truncated }
    return { probe, historyMissing: false }
  }
  const history = records([await port.find("getHistoricProcessInstance", idInput(id))])[0]
  if (first && history === undefined) throw instanceMissing(id)
  return {
    probe: { id, ended: true, tree: [] },
    state: str(history, "state") ?? "ENDED",
    historyMissing: history === undefined,
  }
}

/** Executes the due jobs of the tree in due date order; the first failure ends the wait. */
async function runDueJobs(
  deps: WaitDeps,
  tree: readonly string[],
): Promise<JobFailure | undefined> {
  const query = { ...EXECUTABLE, sortBy: "jobDueDate", sortOrder: "asc" }
  const request = { operationId: "getJobs", key: "processInstanceIds", ids: tree, query }
  const jobs = (await listByIds(deps.port, { ...request, cap: DUE_JOBS }))
    .toSorted((left, right) => compareTime(str(left, "dueDate"), str(right, "dueDate")))
    .slice(0, DUE_JOBS)
  for (const job of jobs) {
    const outcome = await executeJob(deps.port, field(job, "id"), deps.sleep)
    if (outcome.result === "failed") return omit(outcome, "result")
  }
  return undefined
}

interface WaitRun {
  readonly ending?: Ending
  readonly seen: Seen
  readonly polls: number
  readonly elapsedMs: number
}

/** The instance to wait for; `known` when it surely exists (just started, selected by filters). */
export interface WaitTarget {
  readonly id: string
  readonly known: boolean
}

/** The same instances, in any order. */
function sameTree(left: readonly string[], right: readonly string[]): boolean {
  const ids = new Set(left)
  return left.length === right.length && right.every((id) => ids.has(id))
}

/**
 * `idle` speaks about the whole tree at one moment, but the tree and the job count are read one
 * after the other: a job that starts a called instance whose first job is due can commit between
 * them, and the count sees neither job. So the tree of an idle verdict is read again after the
 * counts; on a changed tree (also the empty tree of an instance that ended meanwhile) `idle` does
 * not hold for this poll. A cut tree is taken as it is (instances beyond it are never counted).
 */
async function treeKept(port: EnginePort, probe: Probe): Promise<boolean> {
  if (probe.ended || probe.truncated === true) return true
  const again = await look(port, probe.id, false)
  return sameTree(again.probe.tree, probe.tree)
}

/**
 * The verdict of one poll. `idle` holds only on a tree that held still; without
 * it the other conditions decide (what they found exists, whatever the tree did meanwhile).
 */
async function judge(port: EnginePort, probe: Probe, settings: WaitSettings): Promise<Verdict> {
  const { conditions, failOnIncident } = settings
  const checkIncidents =
    failOnIncident || conditions.some((condition) => condition.kind === "incident")
  const measurement = await measure(port, probe, conditions, checkIncidents)
  const verdict = decide(conditions, failOnIncident, probe, measurement)
  if (verdict.kind !== "held" || verdict.until !== "idle" || (await treeKept(port, probe))) {
    return verdict
  }
  const held = measurement.held.filter((label) => label !== "idle")
  return decide(conditions, failOnIncident, probe, { ...measurement, held })
}

async function run(deps: WaitDeps, target: WaitTarget, settings: WaitSettings): Promise<WaitRun> {
  const { id } = target
  let seen: Seen = { probe: { id, ended: false, tree: [] }, historyMissing: false }
  const result = await poll<Ending>(
    async (polls) => {
      seen = await look(deps.port, id, polls === 1 && !target.known)
      const verdict = await judge(deps.port, seen.probe, settings)
      if (verdict.kind !== "pending") return verdict
      const failure = settings.executeJobs ? await runDueJobs(deps, seen.probe.tree) : undefined
      return failure === undefined ? undefined : { kind: "job-failed", failure }
    },
    {
      now: deps.now,
      sleep: deps.sleep,
      timeoutMs: settings.timeoutMs,
      waiting: () => {
        const until = settings.conditions.map(conditionLabel).join(" or ")
        deps.notice?.(waitingNotice(until, settings.timeoutMs))
      },
    },
  )
  return {
    ...compact({ ending: result.value }),
    seen,
    polls: result.polls,
    elapsedMs: result.elapsedMs,
  }
}

export interface WaitResult {
  readonly view: InstanceView | EndedInstance
  readonly failure?: PulseCliError
}

/** True for a job the job executor runs now: retries left, active and due. */
function isDue(wait: WaitState, now: number): boolean {
  if (wait.kind !== "timer" && wait.kind !== "asyncContinuation") return false
  const due = engineTime(wait.dueDate) ?? Number.NEGATIVE_INFINITY
  return wait.retries > 0 && wait.suspended !== true && due <= now
}

/** The wait states of an instance without a due job (where it rests); undefined otherwise. */
function idleAt(view: InstanceView | EndedInstance, now: number) {
  if (!("waitingAt" in view) || view.waitingAt.some((wait) => isDue(wait, now))) return undefined
  return view.waitingAt
}

function failureOf(
  run: WaitRun,
  view: InstanceView | EndedInstance,
  settings: WaitSettings,
  now: number,
): PulseCliError | undefined {
  const { id } = view
  const until = settings.conditions.map(conditionLabel)
  switch (run.ending?.kind) {
    case "held":
      return undefined
    case "incident":
      return incidentError(id, "incidents" in view ? view.incidents : [])
    case "ended":
      return endedError(id, until, run.seen.state ?? "ENDED")
    case "job-failed":
      return jobFailedError([run.ending.failure])
    case undefined:
      return timeoutError(id, until, settings.timeoutMs, { ...run, idleAt: idleAt(view, now) })
  }
}

/** Waits for the instance, then loads its view (with `waited` on success). */
export async function waitAndInspect(
  deps: WaitDeps,
  target: WaitTarget,
  settings: WaitSettings,
  options: InspectOptions,
): Promise<WaitResult> {
  const { id } = target
  const result = await run(deps, target, settings)
  const view: InstanceView | EndedInstance = result.seen.historyMissing
    ? { id, state: "ENDED" }
    : await loadView(deps.port, id, options)
  const failure = failureOf(result, view, settings, deps.now())
  if (failure !== undefined) return { view, failure }
  const until = result.ending?.kind === "held" ? result.ending.until : ""
  return { view: { ...view, waited: { until, elapsedMs: result.elapsedMs, polls: result.polls } } }
}
