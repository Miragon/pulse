import { describe, expect, it } from "vitest"
import { WorkflowError, type WorkflowErrorReason } from "@miragon/pulse-engine-core"
import { asToolError, WorkflowToolError } from "./workflow-errors.js"

const of = (reason: WorkflowErrorReason) => {
  const error = asToolError(new WorkflowError(reason))
  if (!(error instanceof WorkflowToolError)) throw new Error("expected a WorkflowToolError")
  return [error.code, error.message]
}

const candidate = (id: string) => ({ id, key: "order", state: "ACTIVE" })

describe("asToolError", () => {
  it("words each selection reason in the tools' parameter names", () => {
    expect(of({ kind: "selection-conflict" })).toEqual([
      "INVALID_SELECTION",
      "processInstanceId excludes businessKey, processDefinitionKey and latest.",
    ])
    expect(of({ kind: "selection-missing", latest: true })).toEqual([
      "INVALID_SELECTION",
      "latest needs businessKey or processDefinitionKey.",
    ])
    expect(of({ kind: "selection-missing", latest: false })).toEqual([
      "INVALID_SELECTION",
      "Select a process instance: processInstanceId, businessKey (optionally with processDefinitionKey) or processDefinitionKey with latest: true.",
    ])
    expect(
      of({
        kind: "selection-not-found",
        selection: { businessKey: "B-1", processDefinitionKey: "order", latest: false },
      }),
    ).toEqual([
      "NOT_FOUND",
      'No process instance with businessKey "B-1" and processDefinitionKey "order", running or in the history. If the engine\'s history level is none, ended instances cannot be found.',
    ])
    expect(of({ kind: "latest-needs-history" })).toEqual([
      "INVALID_SELECTION",
      "latest needs the history (level activity or higher) to order instances; pass processInstanceId instead.",
    ])
    expect(of({ kind: "instance-missing", id: "p1" })).toEqual([
      "NOT_FOUND",
      "Process instance p1 does not exist, neither running nor in the history. If the engine's history level is none, ended instances cannot be found.",
    ])
  })

  it("lists the candidates of an ambiguous selection and offers only the filter not given", () => {
    const three = ["a", "b", "c"].map(candidate)
    expect(
      of({
        kind: "selection-ambiguous",
        selection: { businessKey: "B-1", latest: false },
        candidates: three,
        more: false,
      }),
    ).toEqual([
      "AMBIGUOUS_SELECTION",
      `businessKey "B-1" matches 3 process instances: pass one as processInstanceId, narrow with processDefinitionKey, or take the most recently started with latest: true. Candidates, running before ended, the most recently started first (running ones without startTime last, in engine order): ${JSON.stringify(three)}`,
    ])
    const [, byKey] = of({
      kind: "selection-ambiguous",
      selection: { processDefinitionKey: "order", latest: false },
      candidates: three,
      more: false,
    })
    expect(byKey).toContain("pass one as processInstanceId, narrow with businessKey, or take")
    const ten = Array.from({ length: 10 }, (_, index) => candidate(`p${index}`))
    const [, both] = of({
      kind: "selection-ambiguous",
      selection: { businessKey: "B-1", processDefinitionKey: "order", latest: false },
      candidates: ten,
      more: true,
    })
    expect(both).toContain('processDefinitionKey "order" match more than 10 process instances')
    expect(both).toContain("pass one as processInstanceId, or take the most recently started")
    expect(both).toContain(JSON.stringify(ten))
  })

  it("names the engine asked in a NOT_FOUND, as the client's engine errors do", () => {
    const missing = asToolError(new WorkflowError({ kind: "instance-missing", id: "p1" }), "prod-a")
    expect(missing).toMatchObject({
      code: "NOT_FOUND",
      message:
        "Process instance p1 does not exist, neither running nor in the history (engine prod-a). If the engine's history level is none, ended instances cannot be found.",
    })
    const conflict = asToolError(new WorkflowError({ kind: "selection-conflict" }), "prod-a")
    expect((conflict as Error).message).not.toContain("prod-a")
  })

  it("keeps the kind of any other reason and returns other errors unchanged", () => {
    expect(of({ kind: "advance-suspended", id: "p1" })).toEqual(["WORKFLOW", "advance-suspended"])
    const other = new Error("[500] boom")
    expect(asToolError(other)).toBe(other)
  })
})
