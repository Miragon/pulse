import { describe, expect, it } from "vitest"
import { isWorkflowError, WorkflowError } from "./errors.js"

describe("WorkflowError", () => {
  it("carries its reason; its message is the reason's kind", () => {
    const error = new WorkflowError({ kind: "instance-missing", id: "p1" })
    expect(error).toBeInstanceOf(Error)
    expect([error.name, error.message]).toEqual(["WorkflowError", "instance-missing"])
    expect(error.reason).toEqual({ kind: "instance-missing", id: "p1" })
    expect([isWorkflowError(error), isWorkflowError(new Error("x")), isWorkflowError("x")]).toEqual(
      [true, false, false],
    )
  })
})
