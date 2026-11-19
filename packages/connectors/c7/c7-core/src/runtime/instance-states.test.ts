import { RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { instanceStateOf } from "./instance-states.js"

describe("instanceStateOf", () => {
  it.each([
    ["ACTIVE", "running"],
    ["SUSPENDED", "suspended"],
    ["COMPLETED", "completed"],
    ["EXTERNALLY_TERMINATED", "terminated"],
    ["INTERNALLY_TERMINATED", "terminated"],
  ])("reads the history's %s as %s", (engineState, state) => {
    expect(instanceStateOf(engineState)).toBe(state)
  })

  it("fails a state no engine of the family writes as an answer it cannot use", () => {
    let thrown: unknown
    try {
      instanceStateOf("PAUSED")
    } catch (error: unknown) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(RuntimeError)
    expect(thrown).toMatchObject({
      failure: "unexpectedResponse",
      message: "Unknown process instance state PAUSED",
    })
  })
})
