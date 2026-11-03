import { describe, expect, it } from "vitest"
import {
  advanceSteps,
  checkAdvanceInput,
  checkLock,
  checkOptions,
  checkSuspended,
  chooseWait,
} from "./advance-plan.js"
import { isWorkflowError, type WorkflowErrorReason } from "./errors.js"
import {
  ASYNC,
  CONDITIONAL,
  EXTERNAL,
  MESSAGE,
  RECEIVE,
  SIGNAL,
  TIMER,
  USER_TASK,
  VARS,
} from "./testing/waits.js"
import type { InstanceView, WaitState } from "./types.js"

function reasonOf(fn: () => unknown): WorkflowErrorReason {
  try {
    fn()
  } catch (error) {
    if (isWorkflowError(error)) return error.reason
  }
  throw new Error("expected a WorkflowError")
}

function view(
  waitingAt: readonly WaitState[],
  overrides: Partial<InstanceView> = {},
): InstanceView {
  return {
    id: "p1",
    definition: { key: "k", id: "k:1:x" },
    state: "ACTIVE",
    waitingAt,
    incidents: [],
    children: [],
    next: [],
    ...overrides,
  }
}

describe("advanceSteps", () => {
  it("moves each kind with the injected worker id", () => {
    const steps = (wait: WaitState, input = {}) =>
      advanceSteps(wait, input, "worker").map((step) => [
        step.operationId,
        step.input.pathArgs,
        step.input.body,
      ])
    expect(steps(USER_TASK, VARS)).toEqual([["complete", ["t1"], VARS]])
    expect(steps(USER_TASK, { bpmnError: "E", errorMessage: "no" })).toEqual([
      ["handleBpmnError", ["t1"], { errorCode: "E", errorMessage: "no" }],
    ])
    expect(steps(EXTERNAL)).toEqual([
      ["lock", ["e1"], { workerId: "worker", lockDuration: 60_000 }],
      ["completeExternalTaskResource", ["e1"], { workerId: "worker" }],
    ])
    expect(steps(EXTERNAL, { workerId: "w2", bpmnError: "E" })[1]).toEqual([
      "handleExternalTaskBpmnError",
      ["e1"],
      { workerId: "w2", errorCode: "E" },
    ])
    expect(steps(EXTERNAL, { fail: "boom", localVariables: VARS.variables })[1]).toEqual([
      "handleFailure",
      ["e1"],
      {
        workerId: "worker",
        errorMessage: "boom",
        retries: 0,
        retryTimeout: 0,
        localVariables: VARS.variables,
      },
    ])
    expect([steps(TIMER), steps(ASYNC)]).toEqual([
      [["executeJob", ["j1"], undefined]],
      [["executeJob", ["j2"], undefined]],
    ])
    expect(steps(MESSAGE)).toEqual([["triggerEvent", ["x1", "Paid"], {}]])
    expect(steps(SIGNAL, VARS)).toEqual([
      ["throwSignal", [], { name: "Go", executionId: "x2", ...VARS }],
    ])
    expect(steps(RECEIVE)).toEqual([["signalExecution", ["x3"], {}]])
    expect(advanceSteps(EXTERNAL, {}, "worker")[0]?.label).toBe("lock external task e1 as worker")
  })
})

describe("the checks of advance", () => {
  it("refuses option combinations", () => {
    expect(
      reasonOf(() => {
        checkAdvanceInput({ bpmnError: "E", fail: "x" })
      }),
    ).toEqual({
      kind: "advance-input",
      rule: "bpmn-error-excludes-fail",
    })
    expect(
      reasonOf(() => {
        checkAdvanceInput({ errorMessage: "m" })
      }),
    ).toMatchObject({
      rule: "error-message-needs-bpmn-error",
    })
    expect(
      reasonOf(() => {
        checkAdvanceInput({ retries: 1 })
      }),
    ).toMatchObject({ rule: "retries-need-fail" })
    expect(() => {
      checkAdvanceInput({ fail: "x", retries: 2 })
    }).not.toThrow()
  })

  it("chooses the only movable wait state and explains every refusal", () => {
    expect(chooseWait(view([USER_TASK, CONDITIONAL]))).toBe(USER_TASK)
    expect(chooseWait(view([{ ...TIMER, suspended: true }, USER_TASK]))).toBe(USER_TASK)
    expect(reasonOf(() => chooseWait(view([], { state: "COMPLETED" })))).toEqual({
      kind: "advance-ended",
      id: "p1",
      state: "COMPLETED",
    })
    expect(reasonOf(() => chooseWait(view([], { state: "SUSPENDED" })))).toEqual({
      kind: "advance-suspended",
      id: "p1",
    })
    expect(reasonOf(() => chooseWait(view([USER_TASK]), "other"))).toEqual({
      kind: "advance-nothing",
      id: "p1",
      activityId: "other",
      waiting: [{ activityId: "approve", kind: "userTask" }],
      conditional: false,
    })
    expect(
      reasonOf(() =>
        chooseWait(
          view([CONDITIONAL], {
            truncated: true,
            children: [{ id: "c1", parentId: "p1", key: "k", state: "ACTIVE" }],
          }),
        ),
      ),
    ).toEqual({
      kind: "advance-nothing",
      id: "p1",
      waiting: [],
      conditional: true,
      firstChildId: "c1",
    })
    expect(reasonOf(() => chooseWait(view([USER_TASK, EXTERNAL])))).toEqual({
      kind: "advance-ambiguous",
      id: "p1",
      waits: [USER_TASK, EXTERNAL],
    })
  })

  it("refuses options that do not apply, suspended jobs and foreign locks", () => {
    expect(
      reasonOf(() => {
        checkOptions(USER_TASK, { fail: "x" })
      }),
    ).toEqual({
      kind: "advance-option-kind",
      option: "fail",
      appliesTo: ["externalTask"],
      activityId: "approve",
      waitKind: "userTask",
    })
    expect(() => {
      checkOptions(EXTERNAL, { fail: "x", workerId: "w" })
    }).not.toThrow()
    expect(
      reasonOf(() => {
        checkSuspended({ ...ASYNC, suspended: true })
      }),
    ).toEqual({
      kind: "advance-job-suspended",
      jobId: "j2",
      activityId: "book",
    })
    expect(() => {
      checkSuspended(ASYNC)
    }).not.toThrow()
    const locked = {
      ...EXTERNAL,
      workerId: "other",
      lockExpirationTime: "2026-01-01T01:00:00.000+0000",
    }
    const now = Date.parse("2026-01-01T00:00:00.000Z")
    expect(
      reasonOf(() => {
        checkLock(locked, {}, now, "worker")
      }),
    ).toEqual({
      kind: "advance-locked",
      externalTaskId: "e1",
      workerId: "other",
      lockExpirationTime: "2026-01-01T01:00:00.000+0000",
    })
    expect(() => {
      checkLock(locked, { workerId: "other" }, now, "worker")
    }).not.toThrow()
    expect(() => {
      checkLock(locked, {}, now + 7_200_000, "worker")
    }).not.toThrow()
    expect(() => {
      checkLock(USER_TASK, {}, now, "worker")
    }).not.toThrow()
  })
})
