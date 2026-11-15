import { describe, expect, test } from "vitest"
import { FilterQuery } from "../../src/builder/filter-query.js"

describe("a board filter", () => {
  test("asks the engine exactly what the file says", () => {
    expect(
      FilterQuery.of({
        state: "running",
        process: "order",
        activeElement: "Task_Pay",
        withIncident: false,
        businessKey: "B-1",
      }),
    ).toEqual({
      lifecycle: "running",
      bpmnProcessId: "order",
      activeElementId: "Task_Pay",
      withIncident: false,
      businessKey: "B-1",
    })
    expect(FilterQuery.of({ state: "ended" })).toEqual({ lifecycle: "ended" })
  })
})
