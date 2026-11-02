/**
 * Planning of `pulse-cli advance`: @miragon/pulse-engine-core's advance plan with the worker id
 * `pulse-cli` and usage errors that name the flags and ready commands.
 */

import * as core from "@miragon/pulse-engine-core"
import { rendered } from "./error-text.js"
import type { InstanceView, PlannedWrite } from "./types.js"
import { plannedWrite } from "./writes.js"

/** The worker id that locks an external task unless `--worker-id` names another. */
const DEFAULT_WORKER = "pulse-cli"

/** Option combinations, checked before any request. */
export function checkAdvanceInput(input: core.AdvanceInput): void {
  rendered(() => {
    core.checkAdvanceInput(input)
  })
}

/**
 * The wait state to move: the only advanceable one (of `activityId`). `options` are the other
 * words of the command line (shell quoted); the ready commands of a choice keep them.
 */
export function chooseWait(
  view: InstanceView,
  activityId?: string,
  options: readonly string[] = [],
): core.WaitState {
  return rendered(() => core.chooseWait(view, activityId), { options })
}

/** Options that do not apply to the chosen wait state are usage errors. */
export function checkOptions(wait: core.WaitState, input: core.AdvanceInput): void {
  rendered(() => {
    core.checkOptions(wait, input)
  })
}

/** A suspended job is not executed behind the operator's back. */
export function checkSuspended(wait: core.WaitState): void {
  rendered(() => {
    core.checkSuspended(wait)
  })
}

/** A lock of another worker that has not expired is a usage error. */
export function checkLock(wait: core.WaitState, input: core.AdvanceInput, now: number): void {
  rendered(() => {
    core.checkLock(wait, input, now, DEFAULT_WORKER)
  })
}

/** The writes that move the wait state, in order. */
export function advanceSteps(wait: core.WaitState, input: core.AdvanceInput): PlannedWrite[] {
  return core.advanceSteps(wait, input, DEFAULT_WORKER).map(plannedWrite)
}
