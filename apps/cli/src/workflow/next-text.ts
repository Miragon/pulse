/**
 * The next steps of @miragon/pulse-engine-core as ready-to-run `pulse` command lines, always
 * with ids (never business keys), so they are reproducible. Pure.
 */

import {
  type FindingStep,
  type GroupStep,
  type ItemWait,
  itemStep,
  type NextStep,
  type SkipStep,
  type WaitState,
} from "@miragon/pulse-engine-core"
import { shellWord } from "./shell.js"

/** The generated command that moves one wait state. */
function moveCommand(wait: ItemWait): string {
  switch (wait.kind) {
    case "userTask":
      return `pulse task complete ${wait.taskId}`
    case "timer":
    case "asyncContinuation":
      return `pulse job execute ${wait.jobId}`
    case "message":
      return `pulse execution trigger-event ${wait.executionId} ${shellWord(wait.eventName ?? "")}`
    case "signal":
      return `pulse signal throw --name ${shellWord(wait.eventName ?? "")} --execution-id ${wait.executionId}`
    case "other":
      return `pulse execution signal ${wait.executionId}`
  }
}

/**
 * The generated command that moves one wait state (an item of a multi-instance activity) when its
 * ids are all it needs; undefined for external tasks (they need a lock first) and conditions.
 */
export function itemCommand(wait: WaitState): string | undefined {
  const step = itemStep(wait)
  return step === undefined ? undefined : moveCommand(step.wait)
}

/** A next step of the instance view as its command line. */
export function nextCommand(step: NextStep): string {
  switch (step.action) {
    case "retry":
      return `pulse retry ${step.processInstanceId}`
    case "activate":
      return `pulse process-instance activate ${step.processInstanceId}`
    case "advance":
      return step.activityId === undefined
        ? `pulse advance ${step.processInstanceId}`
        : `pulse advance ${step.processInstanceId} --activity-id ${shellWord(step.activityId)}`
    case "move":
      return moveCommand(step.wait)
    case "inspectHistory":
      return `pulse inspect ${step.processInstanceId} --history`
  }
}

/** The next step of an incident group as its command line. */
export function groupCommand(step: GroupStep): string {
  switch (step.action) {
    case "listIncidentsOfType":
      return `pulse incident list --incident-type ${shellWord(step.incidentType)}`
    case "listFailedJobs":
      return `pulse job list --job-definition-id ${shellWord(step.jobDefinitionId ?? "<id>")} --with-exception`
    case "retryActivity":
      return `pulse retry --process-definition-key ${shellWord(step.processDefinitionKey)} --activity-id ${shellWord(step.activityId)} --dry-run`
    case "listIncidentsAtActivity":
      return `pulse incident list --process-definition-key-in ${shellWord(step.processDefinitionKey)} --activity-id ${shellWord(step.activityId)}`
  }
}

/** The next step of a finding as its command line. */
export function findingCommand(step: FindingStep): string {
  switch (step.action) {
    case "listOverdueJobs":
      return "pulse job list --executable --sort-by jobDueDate --sort-order asc --max-results 10"
    case "listUnlockedTasks":
      return `pulse external-task list --topic-name ${shellWord(step.topic)} --not-locked`
    case "listExpiredLocks":
      return `pulse external-task list --topic-name ${shellWord(step.topic)} --not-locked --with-retries-left`
    case "listDefinitions":
      return "pulse process-definition list --latest-version --sort-by key --sort-order asc"
    default:
      return groupCommand(step)
  }
}

/** What to do about an incident retry cannot fix, as its command line. */
export function skipCommand(step: SkipStep): string {
  return `pulse incident resolve ${step.incidentId} --yes`
}
