/**
 * Planning of advance: which wait state to move, which options apply to it, and the requests that
 * move it. Pure.
 */

import { WorkflowError } from "./errors.js"
import { isAdvanceable, isSuspendedJob } from "./next.js"
import type { PlannedWrite } from "./port.js"
import { engineTime } from "./records.js"
import type { AdvanceInput, AdvanceOption, InstanceView, WaitKind, WaitState } from "./types.js"
import { compact } from "./util.js"
import { waitId } from "./waits.js"

const LOCK_DURATION_MS = 60_000

const TASKS: readonly WaitKind[] = ["userTask", "externalTask"]

/** The kinds each option applies to, in the order the options are checked. */
const OPTION_KINDS: Readonly<Record<AdvanceOption, readonly WaitKind[]>> = {
  variables: ["userTask", "externalTask", "message", "signal", "other"],
  localVariables: ["externalTask"],
  bpmnError: TASKS,
  errorMessage: TASKS,
  fail: ["externalTask"],
  retries: ["externalTask"],
  workerId: ["externalTask"],
}

/** Option combinations, checked before any request. */
export function checkAdvanceInput(input: AdvanceInput): void {
  if (input.bpmnError !== undefined && input.fail !== undefined) {
    throw new WorkflowError({ kind: "advance-input", rule: "bpmn-error-excludes-fail" })
  }
  if (input.errorMessage !== undefined && input.bpmnError === undefined) {
    throw new WorkflowError({ kind: "advance-input", rule: "error-message-needs-bpmn-error" })
  }
  if (input.retries !== undefined && input.fail === undefined) {
    throw new WorkflowError({ kind: "advance-input", rule: "retries-need-fail" })
  }
}

type ViewInput = Pick<
  InstanceView<unknown>,
  "id" | "state" | "waitingAt" | "children" | "truncated"
>

function nothing(view: ViewInput, activityId: string | undefined): WorkflowError {
  const firstChildId = view.truncated === true ? view.children[0]?.id : undefined
  return new WorkflowError({
    kind: "advance-nothing",
    id: view.id,
    ...compact({ activityId }),
    waiting: view.waitingAt
      .filter(isAdvanceable)
      .map((wait) => ({ activityId: wait.activityId, kind: wait.kind })),
    conditional: view.waitingAt.some((wait) => wait.kind === "conditional"),
    ...compact({ firstChildId }),
  })
}

/** The wait state to move: the only advanceable one (of `activityId`). */
export function chooseWait(view: ViewInput, activityId?: string): WaitState {
  if (view.state !== "ACTIVE" && view.state !== "SUSPENDED") {
    throw new WorkflowError({ kind: "advance-ended", id: view.id, state: view.state })
  }
  if (view.state === "SUSPENDED")
    throw new WorkflowError({ kind: "advance-suspended", id: view.id })
  const matching = view.waitingAt.filter(
    (wait) => isAdvanceable(wait) && (activityId === undefined || wait.activityId === activityId),
  )
  // a suspended job does not count as a place while something else can move (like the next steps)
  const movable = matching.filter((wait) => !isSuspendedJob(wait))
  const waits = movable.length > 0 ? movable : matching
  const [only, ...others] = waits
  if (only === undefined) throw nothing(view, activityId)
  if (others.length > 0) throw new WorkflowError({ kind: "advance-ambiguous", id: view.id, waits })
  return only
}

/** Options that do not apply to the chosen wait state are refused. */
export function checkOptions(wait: WaitState, input: AdvanceInput): void {
  for (const [option, kinds] of Object.entries(OPTION_KINDS) as [AdvanceOption, WaitKind[]][]) {
    if (input[option] !== undefined && !kinds.includes(wait.kind)) {
      throw new WorkflowError({
        kind: "advance-option-kind",
        option,
        appliesTo: kinds,
        activityId: wait.activityId,
        waitKind: wait.kind,
      })
    }
  }
}

/** A suspended job is not executed behind the operator's back. */
export function checkSuspended(wait: WaitState): void {
  if (!isSuspendedJob(wait) || !("jobId" in wait)) return
  throw new WorkflowError({
    kind: "advance-job-suspended",
    jobId: wait.jobId,
    activityId: wait.activityId,
  })
}

/** A lock of another worker that has not expired is refused; `worker` is the caller's default. */
export function checkLock(wait: WaitState, input: AdvanceInput, now: number, worker: string): void {
  if (wait.kind !== "externalTask" || wait.workerId === undefined) return
  const own = input.workerId ?? worker
  const until = engineTime(wait.lockExpirationTime)
  if (wait.workerId === own || until === undefined || until <= now) return
  throw new WorkflowError({
    kind: "advance-locked",
    externalTaskId: wait.externalTaskId,
    workerId: wait.workerId,
    ...compact({ lockExpirationTime: wait.lockExpirationTime }),
  })
}

function write(
  label: string,
  operationId: string,
  pathArgs: readonly string[],
  body?: unknown,
): PlannedWrite {
  return {
    label,
    operationId,
    input: { pathArgs, query: {}, ...(body === undefined ? {} : { body }) },
  }
}

function variablesOf(input: AdvanceInput) {
  return compact({ variables: input.variables, localVariables: input.localVariables })
}

function userTaskSteps(taskId: string, input: AdvanceInput): PlannedWrite[] {
  if (input.bpmnError === undefined) {
    return [
      write(
        `complete user task ${taskId}`,
        "complete",
        [taskId],
        compact({ variables: input.variables }),
      ),
    ]
  }
  const body = {
    errorCode: input.bpmnError,
    ...compact({ errorMessage: input.errorMessage, variables: input.variables }),
  }
  return [
    write(
      `throw BPMN error ${input.bpmnError} on user task ${taskId}`,
      "handleBpmnError",
      [taskId],
      body,
    ),
  ]
}

function externalTaskSteps(id: string, input: AdvanceInput, workerId: string): PlannedWrite[] {
  const lock = write(`lock external task ${id} as ${workerId}`, "lock", [id], {
    workerId,
    lockDuration: LOCK_DURATION_MS,
  })
  if (input.bpmnError !== undefined) {
    const body = {
      workerId,
      errorCode: input.bpmnError,
      ...compact({ errorMessage: input.errorMessage, variables: input.variables }),
    }
    return [
      lock,
      write(
        `throw BPMN error ${input.bpmnError} on external task ${id}`,
        "handleExternalTaskBpmnError",
        [id],
        body,
      ),
    ]
  }
  if (input.fail !== undefined) {
    const body = {
      workerId,
      errorMessage: input.fail,
      retries: input.retries ?? 0,
      retryTimeout: 0,
      ...variablesOf(input),
    }
    return [lock, write(`report a failure of external task ${id}`, "handleFailure", [id], body)]
  }
  return [
    lock,
    write(`complete external task ${id}`, "completeExternalTaskResource", [id], {
      workerId,
      ...variablesOf(input),
    }),
  ]
}

/** The write of a message, a signal or a receive task (`other`). */
function eventStep(wait: WaitState, input: AdvanceInput): PlannedWrite {
  const variables = compact({ variables: input.variables })
  if (wait.kind === "message") {
    const name = wait.eventName ?? ""
    const label = `trigger message ${name} of execution ${wait.executionId}`
    return write(label, "triggerEvent", [wait.executionId, name], variables)
  }
  if (wait.kind === "signal") {
    const name = wait.eventName ?? ""
    const body = { name, executionId: wait.executionId, ...variables }
    return write(`send signal ${name} to execution ${wait.executionId}`, "throwSignal", [], body)
  }
  const executionId = waitId(wait)
  return write(`signal execution ${executionId}`, "signalExecution", [executionId], variables)
}

/** The writes that move the wait state, in order; `worker` locks an external task by default. */
export function advanceSteps(wait: WaitState, input: AdvanceInput, worker: string): PlannedWrite[] {
  switch (wait.kind) {
    case "userTask":
      return userTaskSteps(wait.taskId, input)
    case "externalTask":
      return externalTaskSteps(wait.externalTaskId, input, input.workerId ?? worker)
    case "timer":
    case "asyncContinuation":
      return [write(`execute job ${wait.jobId}`, "executeJob", [wait.jobId])]
    default:
      return [eventStep(wait, input)]
  }
}
