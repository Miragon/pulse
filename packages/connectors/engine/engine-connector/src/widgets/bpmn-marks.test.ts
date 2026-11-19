import { describe, expect, it } from "vitest"
import { markedIdsOf } from "./bpmn-diagram.js"

describe("markedIdsOf: where a diagram's first zoom in centres", () => {
  it("takes the incident's elements before a wait state, a task or failed jobs", () => {
    expect(
      markedIdsOf([
        { kind: "active", activityIds: ["Wait"] },
        { kind: "failed-jobs", counts: [{ activityId: "Retry", count: 2 }] },
        { kind: "incident", activityIds: ["Check", "Charge"] },
      ]),
    ).toEqual(["Check", "Charge"])
  })

  it("falls back mark by mark, and running counts mark nothing", () => {
    expect(markedIdsOf([{ kind: "open-task", activityIds: ["Approve"] }])).toEqual(["Approve"])
    expect(markedIdsOf([{ kind: "active", activityIds: ["Wait"] }])).toEqual(["Wait"])
    expect(
      markedIdsOf([{ kind: "failed-jobs", counts: [{ activityId: "Retry", count: 2 }] }]),
    ).toEqual(["Retry"])
    expect(
      markedIdsOf([{ kind: "instance-count", counts: [{ activityId: "Wait", count: 9 }] }]),
    ).toEqual([])
    expect(markedIdsOf([])).toEqual([])
  })
})
