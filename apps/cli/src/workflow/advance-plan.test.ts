import { describe, expect, it } from "vitest"
import {
  ASYNC,
  EXTERNAL,
  MESSAGE,
  RECEIVE,
  SIGNAL,
  TIMER,
  USER_TASK,
  usage,
  VARS,
} from "../../test/support/advance-plan.js"
import { advanceSteps, checkAdvanceInput, checkLock, checkOptions } from "./advance-plan.js"
import type { WaitState } from "./types.js"

describe("advanceSteps", () => {
  it.each([
    ["user task", USER_TASK, {}, [["complete", ["t1"], {}]]],
    ["user task with variables", USER_TASK, VARS, [["complete", ["t1"], VARS]]],
    [
      "user task BPMN error",
      USER_TASK,
      { bpmnError: "REJECTED", errorMessage: "no" },
      [["handleBpmnError", ["t1"], { errorCode: "REJECTED", errorMessage: "no" }]],
    ],
    [
      "external task",
      EXTERNAL,
      { ...VARS, localVariables: { l: { value: 1, type: "Integer" } } },
      [
        ["lock", ["e1"], { workerId: "operate", lockDuration: 60000 }],
        [
          "completeExternalTaskResource",
          ["e1"],
          { workerId: "operate", ...VARS, localVariables: { l: { value: 1, type: "Integer" } } },
        ],
      ],
    ],
    [
      "external task failure",
      EXTERNAL,
      { fail: "Card declined", retries: 2, workerId: "w1" },
      [
        ["lock", ["e1"], { workerId: "w1", lockDuration: 60000 }],
        [
          "handleFailure",
          ["e1"],
          { workerId: "w1", errorMessage: "Card declined", retries: 2, retryTimeout: 0 },
        ],
      ],
    ],
    [
      "external task BPMN error",
      EXTERNAL,
      { bpmnError: "NO_FUNDS" },
      [
        ["lock", ["e1"], { workerId: "operate", lockDuration: 60000 }],
        ["handleExternalTaskBpmnError", ["e1"], { workerId: "operate", errorCode: "NO_FUNDS" }],
      ],
    ],
    ["timer", TIMER, {}, [["executeJob", ["j1"], undefined]]],
    ["async job", ASYNC, {}, [["executeJob", ["j2"], undefined]]],
    ["message", MESSAGE, VARS, [["triggerEvent", ["x1", "Paid"], VARS]]],
    ["signal", SIGNAL, {}, [["throwSignal", [], { name: "Go", executionId: "x2" }]]],
    ["receive task", RECEIVE, VARS, [["signalExecution", ["x3"], VARS]]],
  ])("moves a %s", (_, wait, input, expected) => {
    const steps = advanceSteps(wait, input)
    expect(steps.map((step) => [step.operationId, step.input.pathArgs, step.input.body])).toEqual(
      expected,
    )
    expect(steps.every((step) => step.summary.length > 0)).toBe(true)
  })

  it("names the writes for the dry-run", () => {
    expect(advanceSteps(EXTERNAL, { workerId: "w" }).map((step) => step.summary)).toEqual([
      "lock external task e1 as w",
      "complete external task e1",
    ])
    expect(advanceSteps(MESSAGE, {}).map((step) => step.summary)).toEqual([
      "trigger message Paid of execution x1",
    ])
  })
})

describe("checkAdvanceInput", () => {
  it.each([
    [{ bpmnError: "X", fail: "y" }, "--bpmn-error excludes --fail"],
    [{ errorMessage: "x" }, "--error-message needs --bpmn-error"],
    [{ retries: 1 }, "--retries needs --fail"],
  ])("refuses %j", (input, message) => {
    expect(
      usage(() => {
        checkAdvanceInput(input)
      }).message,
    ).toBe(message)
  })
})

describe("checkOptions", () => {
  it.each([
    [USER_TASK, { fail: "x" }, "--fail applies to external tasks only; approve is a userTask"],
    [
      USER_TASK,
      { localVariables: {} },
      "--local-var applies to external tasks only; approve is a userTask",
    ],
    [
      TIMER,
      { variables: {} },
      "--var applies to user tasks, external tasks, messages, signals and receive tasks only; cool-down is a timer",
    ],
    [
      MESSAGE,
      { bpmnError: "X" },
      "--bpmn-error applies to user tasks and external tasks only; paid is a message",
    ],
    [
      ASYNC,
      { workerId: "w" },
      "--worker-id applies to external tasks only; book is a asyncContinuation",
    ],
  ])("refuses options that do not apply (%#)", (wait, input, message) => {
    expect(
      usage(() => {
        checkOptions(wait, input)
      }).message,
    ).toBe(message)
  })

  it("accepts the options of the kind", () => {
    expect(() => {
      checkOptions(EXTERNAL, {
        variables: {},
        localVariables: {},
        fail: "x",
        retries: 1,
        workerId: "w",
      })
      checkOptions(RECEIVE, { variables: {} })
    }).not.toThrow()
  })
})

describe("checkLock", () => {
  const locked: WaitState = {
    ...EXTERNAL,
    workerId: "other",
    lockExpirationTime: "2026-01-01T00:01:00.000+0000",
  }
  const now = Date.parse("2026-01-01T00:00:00.000Z")

  it("refuses a lock of another worker that has not expired", () => {
    const error = usage(() => {
      checkLock(locked, {}, now)
    })
    expect(error.message).toBe(
      "External task e1 is locked by worker other until 2026-01-01T00:01:00.000+0000",
    )
    expect(error.details.hint).toBe(
      "Pass --worker-id other, or unlock it: `operate external-task unlock e1`.",
    )
  })

  it("accepts the same worker, an expired lock and other kinds", () => {
    expect(() => {
      checkLock(locked, { workerId: "other" }, now)
      checkLock(locked, {}, now + 120_000)
      checkLock(EXTERNAL, {}, now)
      checkLock(USER_TASK, {}, now)
    }).not.toThrow()
  })
})
