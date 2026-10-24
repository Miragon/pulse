/** nextCommands and its details (next.ts). */

import { describe, expect, it } from "vitest"
import { isAdvanceable, nextCommands } from "./next.js"

describe("nextCommands", () => {
  const base = { id: "p1", state: "ACTIVE" as const, waitingAt: [], incidents: [] }

  it("suggests retry, advance and history in this order, at most 3", () => {
    expect(nextCommands(base, false)).toEqual([])
    expect(
      nextCommands(
        {
          ...base,
          incidents: [{ id: "i", type: "failedExternalTask", activityId: "a", since: "s" }],
        },
        false,
      ),
    ).toEqual(["pulse-cli retry p1"])
    expect(
      nextCommands(
        { ...base, incidents: [{ id: "i", type: "custom", activityId: "a", since: "s" }] },
        false,
      ),
    ).toEqual([])
    const waits = ["a", "b", "c"].map((activityId) => ({
      activityId,
      kind: "userTask" as const,
      taskId: activityId,
    }))
    expect(
      nextCommands(
        {
          ...base,
          waitingAt: waits,
          incidents: [{ id: "i", type: "failedJob", activityId: "a", since: "s" }],
        },
        false,
      ),
    ).toEqual([
      "pulse-cli retry p1",
      "pulse-cli advance p1 --activity-id a",
      "pulse-cli advance p1 --activity-id b",
    ])
    expect(nextCommands({ ...base, state: "EXTERNALLY_TERMINATED" }, false)).toEqual([
      "pulse-cli inspect p1 --history",
    ])
    expect(nextCommands({ ...base, state: "SUSPENDED" }, false)).toEqual([
      "pulse-cli process-instance activate p1",
    ])
  })

  it("suggests the item command of a multi-instance activity and skips suspended jobs", () => {
    const task = (taskId: string, activityId = "multi") => ({
      activityId,
      kind: "userTask" as const,
      taskId,
    })
    expect(nextCommands({ ...base, waitingAt: [task("t1"), task("t2")] }, false)).toEqual([
      "pulse-cli task complete t1",
    ])
    expect(
      nextCommands({ ...base, waitingAt: [task("t1"), task("t2"), task("t3", "review")] }, false),
    ).toEqual(["pulse-cli task complete t1", "pulse-cli advance p1 --activity-id review"])
    const external = (id: string) => ({
      activityId: "charge",
      kind: "externalTask" as const,
      externalTaskId: id,
      topic: "t",
    })
    // external tasks need a lock first: no ready item command
    expect(nextCommands({ ...base, waitingAt: [external("e1"), external("e2")] }, false)).toEqual(
      [],
    )
    const suspended = {
      activityId: "book",
      kind: "asyncContinuation" as const,
      jobId: "j1",
      retries: 3,
      suspended: true as const,
    }
    expect(nextCommands({ ...base, waitingAt: [suspended, task("t1", "review")] }, false)).toEqual([
      "pulse-cli advance p1",
    ])
  })
})

describe("nextCommands details", () => {
  const base = { id: "p1", state: "ACTIVE" as const, waitingAt: [], incidents: [] }

  it("advances signals and receive tasks only, skips empty activity ids and caps at 3", () => {
    const signal = {
      activityId: "s",
      kind: "signal" as const,
      eventSubscriptionId: "e",
      executionId: "x",
    }
    expect(nextCommands({ ...base, waitingAt: [signal] }, false)).toEqual(["pulse-cli advance p1"])
    const odd = {
      activityId: "c",
      kind: "conditional" as const,
      activityType: "receiveTask",
      eventSubscriptionId: "e",
      executionId: "x",
    }
    expect(isAdvanceable(odd)).toBe(false)
    const unnamed = [
      { activityId: "", kind: "userTask" as const, taskId: "t1" },
      { activityId: "a", kind: "userTask" as const, taskId: "t2" },
    ]
    expect(nextCommands({ ...base, waitingAt: unnamed }, false)).toEqual([
      "pulse-cli advance p1 --activity-id a",
    ])
    const many = ["a", "b"].map((activityId) => ({
      activityId,
      kind: "userTask" as const,
      taskId: activityId,
    }))
    expect(
      nextCommands(
        {
          ...base,
          state: "COMPLETED",
          waitingAt: many,
          incidents: [{ id: "i", type: "failedJob", activityId: "a", since: "s" }],
        },
        false,
      ),
    ).toEqual([
      "pulse-cli retry p1",
      "pulse-cli advance p1 --activity-id a",
      "pulse-cli advance p1 --activity-id b",
    ])
  })
})
