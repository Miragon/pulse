import { describe, expect, it } from "vitest"
import { collectActiveActivityIds, collectIncidentActivityIds } from "./activity-tree.js"

describe("collectActiveActivityIds", () => {
  it("returns an empty list for null input", () => {
    expect(collectActiveActivityIds(null)).toEqual([])
  })

  it("collects the root id and all nested child ids", () => {
    const tree = {
      activityId: "Process_root",
      childActivityInstances: [
        { activityId: "Activity_A", childActivityInstances: [] },
        {
          activityId: "Activity_B",
          childActivityInstances: [{ activityId: "Activity_BB", childActivityInstances: [] }],
        },
      ],
    }
    expect(collectActiveActivityIds(tree)).toEqual([
      "Process_root",
      "Activity_A",
      "Activity_B",
      "Activity_BB",
    ])
  })

  it("includes ids from transition instances (asyncBefore, async leaving etc.)", () => {
    const tree = {
      activityId: "Process_root",
      childActivityInstances: [],
      childTransitionInstances: [{ activityId: "Activity_AsyncBefore" }],
    }
    expect(collectActiveActivityIds(tree)).toEqual(["Process_root", "Activity_AsyncBefore"])
  })

  it("skips nodes without an activityId without crashing", () => {
    const tree = {
      childActivityInstances: [{ activityId: "Activity_X" }],
      childTransitionInstances: [{}],
    }
    expect(collectActiveActivityIds(tree)).toEqual(["Activity_X"])
  })
})

describe("collectIncidentActivityIds", () => {
  it("returns an empty list for non-array input", () => {
    expect(collectIncidentActivityIds(null)).toEqual([])
    expect(collectIncidentActivityIds(undefined)).toEqual([])
    expect(collectIncidentActivityIds({})).toEqual([])
  })

  it("dedupes and drops missing activityIds", () => {
    const incidents = [
      { activityId: "Activity_A" },
      { activityId: "Activity_B" },
      { activityId: "Activity_A" },
      { activityId: null },
      { activityId: undefined },
      {},
    ]
    expect(collectIncidentActivityIds(incidents)).toEqual(["Activity_A", "Activity_B"])
  })
})

describe("a multi-instance body on the diagram", () => {
  it("counts the items a body runs on the activity it repeats, never the body beside them", () => {
    const tree = {
      activityId: "Process_root",
      childActivityInstances: [
        {
          activityId: "Activity_Approve#multiInstanceBody",
          childActivityInstances: [
            { activityId: "Activity_Approve" },
            { activityId: "Activity_Approve" },
          ],
          childTransitionInstances: [{ activityId: "Activity_Approve" }],
        },
      ],
    }
    expect(collectActiveActivityIds(tree)).toEqual([
      "Process_root",
      "Activity_Approve",
      "Activity_Approve",
      "Activity_Approve",
    ])
  })

  it("marks the body's own token on the activity it repeats where it waits", () => {
    const tree = {
      activityId: "Process_root",
      childActivityInstances: [
        { activityId: "Activity_Approve#multiInstanceBody", childActivityInstances: [] },
      ],
      childTransitionInstances: [{ activityId: "Activity_Ship#multiInstanceBody" }],
    }
    expect(collectActiveActivityIds(tree)).toEqual([
      "Process_root",
      "Activity_Approve",
      "Activity_Ship",
    ])
  })

  it("marks the body's incident on the activity it repeats and keeps the body's own id", () => {
    const incidents = [
      { activityId: "Activity_Approve#multiInstanceBody" },
      { activityId: "Activity_Approve" },
      { activityId: "Activity_Ship" },
    ]
    expect(collectIncidentActivityIds(incidents)).toEqual([
      "Activity_Approve",
      "Activity_Approve#multiInstanceBody",
      "Activity_Ship",
    ])
  })
})
