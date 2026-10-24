/**
 * `operate retry` (design §17.7): sets the retries of the failed jobs and external tasks behind
 * open incidents (root causes only), optionally executes the jobs at once (`--now`) and reports
 * per incident what happened.
 */

import type { EnginePort } from "../engine-port/engine-port.js"
import { OperateError, usageError } from "../errors.js"
import { compact, mapLimit } from "../util.js"
import { isMissing, PARALLEL } from "./engine.js"
import { instanceMissing, loadView } from "./inspect.js"
import { executeJob } from "./jobs.js"
import { type JobFailure, jobFailedError } from "./outcomes.js"
import { type Rec, records } from "./records.js"
import {
  checkRetryCount,
  executeWrite,
  missingRoots,
  type PlanEntry,
  planRetry,
  type RetryFilter,
  type RetryMode,
  retriesWrite,
  retryMode,
  retryPlanView,
  skipNext,
} from "./retry-plan.js"
import { checkSelection, type Selection, selectInstance } from "./select.js"
import { activeTree } from "./tree.js"
import type { EndedInstance, InstanceView, WorkflowResult } from "./types.js"
import { checkUntil } from "./until-check.js"
import { type WaitDeps, type WaitResult, type WaitSettings, waitAndInspect } from "./wait.js"

export interface RetryOptions {
  readonly selection: Selection
  readonly incidentIds: readonly string[]
  readonly filter: RetryFilter
  readonly retries: number
  /** `--now`: execute the retried jobs right away. */
  readonly executeNow: boolean
  readonly wait?: WaitSettings
  readonly variablesShown: boolean
  readonly dryRun: boolean
}

type Result = "retried" | "succeeded" | "failed" | "skipped" | "gone" | "error"

interface RetryEntryView {
  readonly incidentId: string
  readonly type: string
  readonly activityId: string
  readonly processInstanceId: string
  readonly jobId?: string
  readonly externalTaskId?: string
  readonly action: string
  readonly result: Result
  readonly rootCause?: string
  /** The message of a request that failed (`error`). */
  readonly error?: string
  readonly next?: string
}

export interface RetryView {
  readonly retried: number
  readonly succeeded: number
  readonly failed: number
  readonly skipped: number
  readonly gone: number
  /** Retries whose request failed; only when there are any (the first error follows the view). */
  readonly errors?: number
  readonly incidents: readonly RetryEntryView[]
  readonly instance?: InstanceView | EndedInstance
}

interface Loaded {
  readonly incidents: readonly Rec[]
  readonly truncated: boolean
  /** The selected instance (instance mode). */
  readonly instanceId?: string
}

/** Incidents of `retry --process-definition-key` beyond this are not loaded. */
const DEFINITION_CAP = 1000

async function incidentById(port: EnginePort, id: string): Promise<Rec | undefined> {
  return records([await port.find("getIncident", { pathArgs: [id], query: {} })])[0]
}

/** The running instance; undefined once it ended, NOT_FOUND for an id nobody knows. */
async function runningInstance(port: EnginePort, id: string, named: boolean) {
  const input = { pathArgs: [id], query: {} }
  const runtime = records([await port.find("getProcessInstance", input)])[0]
  if (runtime !== undefined || !named) return runtime
  // a typo'd id must not look like "nothing to retry"
  const history = await port.find("getHistoricProcessInstance", input)
  if (history === undefined) throw instanceMissing(id)
  return undefined
}

async function instanceIncidents(port: EnginePort, selection: Selection): Promise<Loaded> {
  const instanceId = await selectInstance(port, selection, "retry")
  const runtime = await runningInstance(port, instanceId, selection.id !== undefined)
  // an ended instance has no tree and no open incidents
  const tree = await activeTree(port, runtime ?? {})
  const pages = await mapLimit(tree.nodes, PARALLEL, (node) =>
    port.list("getIncidents", { processInstanceId: node.id }),
  )
  return { incidents: pages.flatMap((page) => page.items), truncated: false, instanceId }
}

async function namedIncidents(port: EnginePort, ids: readonly string[]): Promise<Loaded> {
  const incidents = await mapLimit(ids, PARALLEL, async (id) => {
    const incident = await incidentById(port, id)
    if (incident === undefined) {
      throw new OperateError("NOT_FOUND", `Incident ${id} does not exist`, {
        hint: "List the open incidents with `operate incident list`; resolved incidents are gone.",
      })
    }
    return incident
  })
  return { incidents, truncated: false }
}

async function load(port: EnginePort, mode: RetryMode, options: RetryOptions): Promise<Loaded> {
  if (mode === "instance") return instanceIncidents(port, options.selection)
  if (mode === "incidents") return namedIncidents(port, options.incidentIds)
  const query = {
    processDefinitionKeyIn: options.selection.processDefinitionKey,
    activityId: options.filter.activityId,
    incidentType: options.filter.incidentType,
  }
  const page = await port.list("getIncidents", query, DEFINITION_CAP)
  return { incidents: page.items, truncated: page.truncated }
}

/**
 * A job or external task that no longer exists (its incident was resolved meanwhile): external
 * tasks answer 404, jobs 500 `ENGINE-13053 No job found with id` (verified on all three engines).
 */
function isGone(error: unknown): boolean {
  if (isMissing(error)) return true
  if (!(error instanceof OperateError) || error.details.status !== 500) return false
  return /ENGINE-13053|No job found/.test(error.details.engineMessage ?? error.message)
}

interface Outcome {
  readonly entry: PlanEntry
  readonly result: Result
  readonly failure?: JobFailure
  /** The error of a request that failed (`error`). */
  readonly error?: OperateError
}

/** Sets the retries; `gone` for a resource resolved meanwhile, `error` for a failed request. */
async function setRetries(port: EnginePort, entry: PlanEntry, retries: number): Promise<Outcome> {
  const write = retriesWrite(entry, retries)
  if (write === undefined) return { entry, result: "skipped" }
  try {
    await port.call(write.operationId, write.input)
    return { entry, result: "retried" }
  } catch (error) {
    if (isGone(error)) return { entry, result: "gone" }
    if (error instanceof OperateError) return { entry, result: "error", error }
    throw error
  }
}

/** `--now`: executes the jobs whose retries were set, one after the other. */
async function execute(deps: WaitDeps, retried: readonly Outcome[]): Promise<Outcome[]> {
  const outcomes: Outcome[] = []
  for (const outcome of retried) {
    const { entry } = outcome
    if (outcome.result !== "retried" || entry.jobId === undefined) {
      outcomes.push(outcome)
      continue
    }
    const executed = await executeJob(deps.port, entry.jobId, deps.sleep)
    if (executed.result === "executed") {
      outcomes.push({ entry, result: "succeeded" })
      continue
    }
    const { result: _, ...failure } = executed
    outcomes.push({
      entry,
      result: "failed",
      failure: {
        ...failure,
        processInstanceId: failure.processInstanceId ?? entry.processInstanceId,
      },
    })
  }
  return outcomes
}

function entryView(outcome: Outcome, options: RetryOptions): RetryEntryView {
  const { entry } = outcome
  const execute = options.executeNow && entry.jobId !== undefined ? ", execute" : ""
  let next: string | undefined
  if (outcome.result === "failed") next = `operate inspect ${entry.processInstanceId} --stacktrace`
  if (outcome.result === "skipped") next = skipNext(entry)
  return {
    incidentId: entry.incidentId,
    type: entry.type,
    activityId: entry.activityId,
    processInstanceId: entry.processInstanceId,
    ...compact({ jobId: entry.jobId, externalTaskId: entry.externalTaskId }),
    action: entry.action === "skip" ? "none" : `retries=${options.retries}${execute}`,
    result: outcome.result,
    ...compact({ rootCause: outcome.failure?.rootCause, error: outcome.error?.message, next }),
  }
}

function report(outcomes: readonly Outcome[], options: RetryOptions): RetryView {
  const incidents = outcomes.map((outcome) => entryView(outcome, options))
  const count = (...results: Result[]) =>
    incidents.filter((entry) => results.includes(entry.result)).length
  const errors = count("error")
  return {
    retried: count("retried", "succeeded", "failed"),
    succeeded: count("succeeded"),
    failed: count("failed"),
    skipped: count("skipped"),
    gone: count("gone"),
    ...compact({ errors: errors > 0 ? errors : undefined }),
    incidents,
  }
}

/** Plans the retries: loads the incidents and their root causes. */
async function plan(port: EnginePort, mode: RetryMode, options: RetryOptions) {
  const loaded = await load(port, mode, options)
  const roots = await mapLimit(missingRoots(loaded.incidents), PARALLEL, (id) =>
    incidentById(port, id),
  )
  const entries = planRetry([...loaded.incidents, ...records(roots)], options.filter)
  checkRetryCount(entries, loaded.truncated, options.selection.processDefinitionKey)
  return { entries, instanceId: loaded.instanceId }
}

function dryRun(mode: RetryMode, entries: readonly PlanEntry[], options: RetryOptions) {
  const writes = entries.flatMap((entry) => retriesWrite(entry, options.retries) ?? [])
  const executes = options.executeNow ? entries.flatMap((entry) => executeWrite(entry) ?? []) : []
  return {
    kind: "dry-run" as const,
    plan: retryPlanView(mode, entries),
    requests: [...writes, ...executes],
  }
}

/**
 * The instance after the retries: after waiting with `--wait`, at once after a failure. A failed
 * read is reported after the retry report (never lost).
 */
async function instanceAfter(
  deps: WaitDeps,
  target: { readonly id: string; readonly wait: WaitSettings },
  options: RetryOptions,
  failed: boolean,
): Promise<Partial<WaitResult>> {
  const { id, wait } = target
  const inspect = { variables: options.variablesShown, history: false, stacktrace: false }
  try {
    if (failed) return { view: await loadView(deps.port, id, inspect) }
    return await waitAndInspect(deps, { id, known: true }, wait, inspect)
  } catch (error) {
    if (error instanceof OperateError) return { failure: error }
    throw error
  }
}

/**
 * The retries and, with `--now`, the executions. Every entry is reported, also after a failed
 * request (its error follows the report); else JOB_FAILED for the jobs that failed again.
 */
async function apply(deps: WaitDeps, entries: readonly PlanEntry[], options: RetryOptions) {
  const retried = await mapLimit(entries, PARALLEL, (entry) =>
    setRetries(deps.port, entry, options.retries),
  )
  const outcomes = options.executeNow ? await execute(deps, retried) : retried
  const view = report(outcomes, options)
  const error = outcomes.find((outcome) => outcome.error !== undefined)?.error
  const failures = outcomes.flatMap((outcome) => outcome.failure ?? [])
  const failed = view.incidents.filter((entry) => entry.result === "failed")
  const jobFailure = failures.length > 0 ? jobFailedError(failures, failed) : undefined
  return { view, failure: error ?? jobFailure }
}

function checkMode(mode: RetryMode, options: RetryOptions): void {
  if (mode === "instance") checkSelection(options.selection)
  else if (options.wait !== undefined) {
    throw usageError(
      "--wait and --until need a process instance",
      "Select one by id, --business-key, or --process-definition-key with --latest.",
    )
  }
}

export async function retry(
  deps: WaitDeps,
  options: RetryOptions,
): Promise<WorkflowResult<RetryView>> {
  const mode = retryMode(options.selection, options.incidentIds)
  checkMode(mode, options)
  const { entries, instanceId } = await plan(deps.port, mode, options)
  if (options.wait !== undefined && instanceId !== undefined) {
    await checkUntil(deps.port, instanceId, options.wait.conditions)
  }
  if (options.dryRun) return dryRun(mode, entries, options)
  const { view, failure: applied } = await apply(deps, entries, options)
  const { wait } = options
  if (wait === undefined || instanceId === undefined) {
    return { kind: "view", view, ...compact({ failure: applied }) }
  }
  const target = { id: instanceId, wait }
  const after = await instanceAfter(deps, target, options, applied !== undefined)
  const failure = applied ?? after.failure
  return {
    kind: "view",
    view: { ...view, ...compact({ instance: after.view }) },
    ...compact({ failure }),
  }
}
