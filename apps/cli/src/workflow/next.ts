/**
 * Ready-to-run follow-ups of the instance view: at most three `pulse-cli` command
 * lines, always with ids (never business keys), so they are reproducible. Pure.
 */

import { shellWord } from "./shell.js"
import type { InstanceView, WaitState } from "./types.js"

const MAX_NEXT = 3
const MAX_ACTIVITIES = 2
const RETRYABLE: ReadonlySet<string> = new Set(["failedJob", "failedExternalTask"])
const ADVANCEABLE: ReadonlySet<string> = new Set([
  "userTask",
  "externalTask",
  "timer",
  "asyncContinuation",
  "message",
  "signal",
])
const RUNNING: ReadonlySet<string> = new Set(["ACTIVE", "SUSPENDED"])

/** Wait states `pulse-cli advance` can move: also receive tasks without a message. */
export function isAdvanceable(wait: WaitState): boolean {
  return (
    ADVANCEABLE.has(wait.kind) || (wait.kind === "other" && wait.activityType === "receiveTask")
  )
}

/** True for incident types whose retries `pulse-cli retry` sets. */
export function isRetryable(type: string): boolean {
  return RETRYABLE.has(type)
}

type NextInput = Pick<InstanceView, "id" | "state" | "waitingAt" | "incidents">

/** A suspended job: `pulse-cli advance` refuses to execute it. */
export function isSuspendedJob(wait: WaitState): boolean {
  return (wait.kind === "timer" || wait.kind === "asyncContinuation") && wait.suspended === true
}

/**
 * The generated command that moves one wait state (an item of a multi-instance activity) when its
 * ids are all it needs; undefined for external tasks (they need a lock first) and conditions.
 */
export function itemCommand(wait: WaitState): string | undefined {
  switch (wait.kind) {
    case "userTask":
      return `pulse-cli task complete ${wait.taskId}`
    case "timer":
    case "asyncContinuation":
      return `pulse-cli job execute ${wait.jobId}`
    case "message":
      return `pulse-cli execution trigger-event ${wait.executionId} ${shellWord(wait.eventName ?? "")}`
    case "signal":
      return `pulse-cli signal throw --name ${shellWord(wait.eventName ?? "")} --execution-id ${wait.executionId}`
    case "other":
      return `pulse-cli execution signal ${wait.executionId}`
    default:
      return undefined
  }
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
 * `pulse-cli advance <id>` for the only wait state; with several, per activity (the first two)
 * `--activity-id`, or the generated command of the first item of a multi-instance activity
 * (`advance --activity-id` refuses to pick one). A suspended instance is activated first.
 */
function advanceCommands(view: NextInput): string[] {
  if (view.state === "SUSPENDED") return [`pulse-cli process-instance activate ${view.id}`]
  const movable = view.waitingAt.filter((wait) => isAdvanceable(wait) && !isSuspendedJob(wait))
  if (movable.length === 1) return [`pulse-cli advance ${view.id}`]
  return [...byActivity(movable).entries()]
    .filter(([activityId]) => activityId !== "")
    .slice(0, MAX_ACTIVITIES)
    .flatMap(([activityId, waits]) => {
      if (waits.length === 1)
        return [`pulse-cli advance ${view.id} --activity-id ${shellWord(activityId)}`]
      return waits[0] === undefined ? [] : (itemCommand(waits[0]) ?? [])
    })
}

/**
 * `pulse-cli retry <id>` for a failed job or external task, the advance commands above, `pulse-cli
 * inspect <id> --history` for an ended instance shown without its history.
 */
export function nextCommands(view: NextInput, historyShown: boolean): string[] {
  const retry = view.incidents.some((incident) => isRetryable(incident.type))
    ? [`pulse-cli retry ${view.id}`]
    : []
  const history =
    !RUNNING.has(view.state) && !historyShown ? [`pulse-cli inspect ${view.id} --history`] : []
  return [...retry, ...advanceCommands(view), ...history].slice(0, MAX_NEXT)
}
