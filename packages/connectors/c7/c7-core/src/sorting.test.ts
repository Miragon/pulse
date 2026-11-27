import { describe, expect, it } from "vitest"
import {
  engineSorting,
  historySorting,
  INSTANCE_HISTORY_ORDER,
  instanceHistoryQuery,
} from "./sorting.js"

describe("engineSorting: the engine takes sortBy and sortOrder only as a pair", () => {
  it("sorts ascending when only sortBy is given", () => {
    expect(engineSorting({ sortBy: "priority" })).toEqual({ sortBy: "priority", sortOrder: "asc" })
  })

  it("keeps an explicit direction", () => {
    expect(engineSorting({ sortBy: "created", sortOrder: "desc" })).toEqual({
      sortBy: "created",
      sortOrder: "desc",
    })
  })

  it("drops a lone sortOrder and sends nothing without sortBy", () => {
    expect(engineSorting({ sortOrder: "desc" })).toEqual({})
    expect(engineSorting({})).toEqual({})
  })
})

describe("instanceHistoryQuery: one total order for an instance's history", () => {
  it("lists the instance's steps by start, then by occurrence, then by id", () => {
    expect(instanceHistoryQuery("p1")).toEqual({
      processInstanceId: "p1",
      sorting: [
        { sortBy: "startTime", sortOrder: "asc" },
        { sortBy: "occurrence", sortOrder: "asc" },
        { sortBy: "activityInstanceId", sortOrder: "asc" },
      ],
    })
  })

  it("ends on the id, the one key no two steps share, so the order is total", () => {
    expect(INSTANCE_HISTORY_ORDER.map(({ sortBy }) => sortBy).at(-1)).toBe("activityInstanceId")
  })
})

describe("historySorting: a caller's key first, the history's one order for its ties", () => {
  it("is the history's one order for a start ascending", () => {
    expect(historySorting({ sortBy: "startTime" })).toEqual([...INSTANCE_HISTORY_ORDER])
    expect(historySorting({ sortBy: "startTime", sortOrder: "asc" })).toEqual([
      ...INSTANCE_HISTORY_ORDER,
    ])
  })

  it("breaks the ties of another key or direction by start, occurrence and id", () => {
    expect(historySorting({ sortBy: "duration", sortOrder: "desc" })).toEqual([
      { sortBy: "duration", sortOrder: "desc" },
      ...INSTANCE_HISTORY_ORDER,
    ])
    expect(historySorting({ sortBy: "startTime", sortOrder: "desc" })).toEqual([
      { sortBy: "startTime", sortOrder: "desc" },
      { sortBy: "occurrence", sortOrder: "asc" },
      { sortBy: "activityInstanceId", sortOrder: "asc" },
    ])
    expect(historySorting({ sortBy: "activityInstanceId", sortOrder: "desc" })).toEqual([
      { sortBy: "activityInstanceId", sortOrder: "desc" },
      { sortBy: "startTime", sortOrder: "asc" },
      { sortBy: "occurrence", sortOrder: "asc" },
    ])
  })

  it("sorts nothing without a key, as engineSorting drops a lone direction", () => {
    expect(historySorting({})).toBeUndefined()
    expect(historySorting({ sortOrder: "desc" })).toBeUndefined()
  })
})
