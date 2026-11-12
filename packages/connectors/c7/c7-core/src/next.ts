/**
 * Ready follow-ups of the instance view: at most three steps, always by id (never by business
 * key), so they are reproducible. A caller renders each step in its own words. Pure.
 */

import { BUILT_IN_INCIDENT_TYPES } from "./incident-recovery.js"
import type { InstanceView, ItemStep, ItemWait, NextStep, WaitState } from "./types.js"

const MAX_NEXT = 3
const MAX_ACTIVITIES = 2
const RETRYABLE: ReadonlySet<string> = new Set(BUILT_IN_INCIDENT_TYPES)
const ADVANCEABLE: ReadonlySet<string> = new Set([
  "userTask",
  "externalTask",
  "timer",
  "asyncContinuation",
  "message",
  "signal",
])
const RUNNING: ReadonlySet<string> = new Set(["ACTIVE", "SUSPENDED"])

/** Wait states advance can move: also receive tasks without a message. */
export function isAdvanceable(wait: WaitState): boolean {
  return (
    ADVANCEABLE.has(wait.kind) || (wait.kind === "other" && wait.activityType === "receiveTask")
  )
}

/** True for incident types whose retries retry sets. */
export function isRetryable(type: string): boolean {
  return RETRYABLE.has(type)
}

type NextInput = Pick<InstanceView<unknown>, "id" | "state" | "waitingAt" | "incidents">

/** A suspended job: advance refuses to execute it. */
export function isSuspendedJob(wait: WaitState): boolean {
  return (wait.kind === "timer" || wait.kind === "asyncContinuation") && wait.suspended === true
}

/**
 * The step that moves one wait state (an item of a multi-instance activity) when its ids are all
 * it needs; undefined for external tasks (they need a lock first) and conditions.
 */
export function itemStep(wait: WaitState): ItemStep | undefined {
  return isItemWait(wait) ? { action: "move", wait } : undefined
}

function isItemWait(wait: WaitState): wait is ItemWait {
  return wait.kind !== "externalTask" && wait.kind !== "conditional"
}

/** The wait states per activity, in the order of the view. */
export function byActivity(waits: readonly WaitState[]): Map<string, WaitState[]> {
  const groups = new Map<string, WaitState[]>()
  for (const wait of waits) {
    groups.set(wait.activityId, [...(groups.get(wait.activityId) ?? []), wait])
  }
  return groups
}

/**
 * Advance the only wait state; with several, per activity (the first two) advance at that
 * activity, or move the first item of a multi-instance activity (advance at an activity refuses
 * to pick one). A suspended instance is activated first.
 */
function advanceSteps(view: NextInput): NextStep[] {
  const processInstanceId = view.id
  if (view.state === "SUSPENDED") return [{ action: "activate", processInstanceId }]
  const movable = view.waitingAt.filter((wait) => isAdvanceable(wait) && !isSuspendedJob(wait))
  if (movable.length === 1) return [{ action: "advance", processInstanceId }]
  return [...byActivity(movable).entries()]
    .filter(([activityId]) => activityId !== "")
    .slice(0, MAX_ACTIVITIES)
    .flatMap(([activityId, waits]): NextStep | NextStep[] => {
      if (waits.length === 1) return [{ action: "advance", processInstanceId, activityId }]
      return waits[0] === undefined ? [] : (itemStep(waits[0]) ?? [])
    })
}

/**
 * Retry for a failed job or external task, the advance steps above, the history of an ended
 * instance shown without it.
 */
export function nextSteps(view: NextInput, historyShown: boolean): NextStep[] {
  const processInstanceId = view.id
  const retry: NextStep[] = view.incidents.some((incident) => isRetryable(incident.type))
    ? [{ action: "retry", processInstanceId }]
    : []
  const history: NextStep[] =
    !RUNNING.has(view.state) && !historyShown
      ? [{ action: "inspectHistory", processInstanceId }]
      : []
  return [...retry, ...advanceSteps(view), ...history].slice(0, MAX_NEXT)
}
