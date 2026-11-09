import { describe, expect, it } from "vitest"
import { byActivity, isRetryable, itemStep, nextSteps } from "./next.js"
import {
  ASYNC,
  CONDITIONAL,
  EXTERNAL,
  MESSAGE,
  RECEIVE,
  TIMER,
  USER_TASK,
} from "./testing/waits.js"
import type { InstanceView, WaitState } from "./types.js"

type NextInput = Pick<InstanceView, "id" | "state" | "waitingAt" | "incidents">
const base: NextInput = { id: "p1", state: "ACTIVE", waitingAt: [], incidents: [] }
const task = (taskId: string, activityId = "approve"): WaitState => ({
  activityId,
  kind: "userTask",
  taskId,
})
const failed = { id: "i", type: "failedJob", activityId: "a", since: "s" }

describe("nextSteps", () => {
  it("retries first, then advances the only movable wait state", () => {
    expect(nextSteps(base, false)).toEqual([])
    expect(nextSteps({ ...base, incidents: [failed], waitingAt: [USER_TASK] }, false)).toEqual([
      { action: "retry", processInstanceId: "p1" },
      { action: "advance", processInstanceId: "p1" },
    ])
    expect(
      nextSteps({ ...base, incidents: [{ ...failed, type: "custom" }], waitingAt: [] }, false),
    ).toEqual([])
  })

  it("activates a suspended instance and asks an ended one for its history", () => {
    expect(nextSteps({ ...base, state: "SUSPENDED", waitingAt: [USER_TASK] }, false)).toEqual([
      { action: "activate", processInstanceId: "p1" },
    ])
    expect(nextSteps({ ...base, state: "COMPLETED" }, false)).toEqual([
      { action: "inspectHistory", processInstanceId: "p1" },
    ])
    expect(nextSteps({ ...base, state: "COMPLETED" }, true)).toEqual([])
  })

  it("advances per activity, moves the first item of a multi-instance activity, at most 3", () => {
    expect(
      nextSteps({ ...base, waitingAt: [task("t1"), task("t2"), task("t3", "review")] }, false),
    ).toEqual([
      { action: "move", wait: task("t1") },
      { action: "advance", processInstanceId: "p1", activityId: "review" },
    ])
    expect(
      nextSteps({ ...base, waitingAt: [EXTERNAL, { ...EXTERNAL, externalTaskId: "e2" }] }, false),
    ).toEqual([])
    const suspended = { ...TIMER, suspended: true as const }
    expect(nextSteps({ ...base, waitingAt: [suspended, task("t1", "review")] }, false)).toEqual([
      { action: "advance", processInstanceId: "p1" },
    ])
    expect(
      nextSteps(
        {
          ...base,
          incidents: [failed],
          waitingAt: [
            task("t1", "a"),
            task("t2", "b"),
            task("t3", "c"),
            { ...ASYNC, activityId: "" },
          ],
        },
        false,
      ),
    ).toEqual([
      { action: "retry", processInstanceId: "p1" },
      { action: "advance", processInstanceId: "p1", activityId: "a" },
      { action: "advance", processInstanceId: "p1", activityId: "b" },
    ])
  })
})

describe("itemStep and helpers", () => {
  it("moves user tasks, jobs, events and receive tasks, never external tasks or conditions", () => {
    expect(
      [USER_TASK, TIMER, ASYNC, MESSAGE, RECEIVE].map((wait) => itemStep(wait)?.action),
    ).toEqual(["move", "move", "move", "move", "move"])
    expect([itemStep(EXTERNAL), itemStep(CONDITIONAL)]).toEqual([undefined, undefined])
    expect([isRetryable("failedJob"), isRetryable("failedExternalTask"), isRetryable("x")]).toEqual(
      [true, true, false],
    )
    expect([...byActivity([task("t1"), task("t2", "b"), task("t3")]).keys()]).toEqual([
      "approve",
      "b",
    ])
  })
})
