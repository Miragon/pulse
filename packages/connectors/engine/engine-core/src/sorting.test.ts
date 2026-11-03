import { describe, expect, it } from "vitest"
import { engineSorting } from "./sorting.js"

describe("engineSorting — the engine takes sortBy and sortOrder only as a pair", () => {
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
