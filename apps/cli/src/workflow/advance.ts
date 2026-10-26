/**
 * `pulse-cli advance`: completes what a process instance waits for. Selects the
 * instance, reads where it waits, sends the writes of the chosen wait state and prints the
 * instance afterwards (optionally after waiting).
 */

import type { EnginePort } from "../engine-port/engine-port.js"
import { PulseCliError } from "../errors.js"
import { compact, omit } from "../util.js"
import {
  type AdvanceInput,
  advanceSteps,
  checkAdvanceInput,
  checkLock,
  checkOptions,
  checkSuspended,
  chooseWait,
} from "./advance-plan.js"

import { loadInstance, loadView } from "./inspect.js"
import { executeJob } from "./jobs.js"
import { type JobFailure, jobFailedError } from "./outcomes.js"
import { checkSelection, type Selection, selectInstance } from "./select.js"
import type {
  EndedInstance,
  InstanceView,
  PlannedWrite,
  WaitKind,
  WaitState,
  WorkflowResult,
} from "./types.js"
import { checkUntil } from "./until-check.js"
import { type WaitDeps, type WaitResult, type WaitSettings, waitAndInspect } from "./wait.js"
import { waitId } from "./waits.js"

interface AdvancedView {
  readonly processInstanceId: string
  readonly activityId: string
  readonly kind: WaitKind
  readonly id: string
  readonly via?: readonly string[]
  readonly executedBy?: "jobExecutor"
}

export interface AdvanceView {
  readonly advanced: AdvancedView
  /** Absent only when reading the instance after the write failed (that error follows). */
  readonly instance?: InstanceView | EndedInstance
}

export interface AdvanceOptions extends AdvanceInput {
  readonly selection: Selection
  /** `--wait` / `--until`; absent without them. */
  readonly wait?: WaitSettings
  readonly variablesShown: boolean
  readonly dryRun: boolean
}

interface Sent {
  readonly via: string[]
  readonly executedBy?: "jobExecutor"
  readonly failure?: JobFailure
}

/** Lock, then complete (or fail); a failed write after the lock unlocks the task (best effort). */
async function lockAndSend(port: EnginePort, steps: readonly PlannedWrite[]): Promise<void> {
  for (const [index, step] of steps.entries()) {
    try {
      await port.call(step.operationId, step.input)
    } catch (error) {
      if (index > 0) {
        const unlock = { pathArgs: step.input.pathArgs, query: {} }
        await port.call("unlock", unlock).catch(() => undefined)
      }
      throw error
    }
  }
}

async function send(
  deps: WaitDeps,
  wait: WaitState,
  steps: readonly PlannedWrite[],
): Promise<Sent> {
  const { port } = deps
  const via = steps.map((step) => port.route(step.operationId, step.input))
  if ("jobId" in wait) {
    const outcome = await executeJob(port, wait.jobId, deps.sleep)
    if (outcome.result === "executed")
      return { via, ...compact({ executedBy: outcome.executedBy }) }
    return { via, failure: omit(outcome, "result") }
  }
  if (wait.kind === "externalTask") {
    await lockAndSend(port, steps)
    return { via }
  }
  for (const step of steps) await port.call(step.operationId, step.input)
  return { via }
}

/** The instance after the write; a failed read is reported after the write (never lost). */
async function after(
  deps: WaitDeps,
  id: string,
  options: AdvanceOptions,
  failed: boolean,
): Promise<Partial<WaitResult>> {
  const inspect = { variables: options.variablesShown, history: false, stacktrace: false }
  try {
    if (options.wait === undefined || failed)
      return { view: await loadView(deps.port, id, inspect) }
    return await waitAndInspect(deps, { id, known: true }, options.wait, inspect)
  } catch (error) {
    if (error instanceof PulseCliError) return { failure: error }
    throw error
  }
}

export async function advance(
  deps: WaitDeps,
  options: AdvanceOptions,
): Promise<WorkflowResult<AdvanceView>> {
  checkSelection(options.selection)
  checkAdvanceInput(options)
  const id = await selectInstance(deps.port, options.selection, "advance")
  const view = await loadInstance(deps.port, id, {
    variables: false,
    history: false,
    stacktrace: false,
  })
  const wait = chooseWait(view, options.activityId, options.selection.options)
  checkOptions(wait, options)
  checkSuspended(wait)
  checkLock(wait, options, deps.now())
  if (options.wait !== undefined) await checkUntil(deps.port, id, options.wait.conditions)
  const steps = advanceSteps(wait, options)
  const advanced: AdvancedView = {
    processInstanceId: wait.processInstanceId ?? id,
    activityId: wait.activityId,
    kind: wait.kind,
    id: waitId(wait),
  }
  if (options.dryRun) return { kind: "dry-run", plan: advanced, requests: steps }
  const sent = await send(deps, wait, steps)
  const result = await after(deps, id, options, sent.failure !== undefined)
  const failure: PulseCliError | undefined =
    sent.failure === undefined ? result.failure : jobFailedError([sent.failure])
  const done = { ...advanced, via: sent.via, ...compact({ executedBy: sent.executedBy }) }
  const report: AdvanceView = { advanced: done, ...compact({ instance: result.view }) }
  return { kind: "view", view: report, ...compact({ failure }) }
}
