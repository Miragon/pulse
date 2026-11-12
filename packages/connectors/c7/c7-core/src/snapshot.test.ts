import { describe, expect, it } from "vitest"
import { instanceView } from "./snapshot.js"
import {
  approveStage,
  bookFailedStage,
  C,
  chargeStage,
  coolDownStage,
  endedStage,
  P,
  paidStage,
  waitSignalStage,
} from "./testing/fixture.js"

describe("instanceView", () => {
  it("names the next steps of every stage as data", () => {
    expect(instanceView(approveStage()).next).toEqual([{ action: "advance", processInstanceId: P }])
    expect(instanceView(chargeStage()).next).toEqual([{ action: "advance", processInstanceId: P }])
    expect(instanceView(paidStage()).next).toEqual([{ action: "advance", processInstanceId: P }])
    expect(instanceView(coolDownStage()).next).toEqual([
      { action: "advance", processInstanceId: P },
    ])
    expect(instanceView(waitSignalStage()).next).toEqual([
      { action: "advance", processInstanceId: P },
    ])
    expect(instanceView(bookFailedStage()).next[0]).toEqual({
      action: "retry",
      processInstanceId: P,
    })
    expect(instanceView(endedStage()).next).toEqual([
      { action: "inspectHistory", processInstanceId: P },
    ])
    expect(instanceView({ ...endedStage(), historyRequested: true }).next).toEqual([])
  })

  it("assembles the approve stage: the wait state of the child, its called instance", () => {
    const view = instanceView(approveStage())
    expect(view).toMatchObject({ id: P, state: "ACTIVE", definition: { key: "workflow-parent" } })
    expect(view.waitingAt).toMatchObject([{ processInstanceId: C, kind: "userTask" }])
    expect(view.children).toMatchObject([{ id: C, parentId: P, key: "workflow-child" }])
  })
})
