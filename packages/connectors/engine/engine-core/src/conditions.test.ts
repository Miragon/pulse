import { describe, expect, it } from "vitest"
import { type Condition, conditionLabel, decide, measure, parseCondition } from "./conditions.js"
import { isWorkflowError } from "./errors.js"
import { fakePort } from "./testing/fake-port.js"

describe("parseCondition", () => {
  it("reads every form and refuses anything else with the accepted forms", () => {
    expect(
      ["idle", "ended", "incident", "task", "task:approve", "activity:a:b"].map(parseCondition),
    ).toEqual([
      { kind: "idle" },
      { kind: "ended" },
      { kind: "incident" },
      { kind: "task" },
      { kind: "task", key: "approve" },
      { kind: "activity", id: "a:b" },
    ])
    for (const raw of ["bogus", "task:", "other:x"]) {
      try {
        parseCondition(raw)
        expect.unreachable()
      } catch (error) {
        expect(isWorkflowError(error) && error.reason).toEqual({
          kind: "condition-invalid",
          raw,
          forms: [
            "idle",
            "ended",
            "incident",
            "task",
            "task:<taskDefinitionKey>",
            "activity:<activityId>",
          ],
        })
      }
    }
    expect(
      (["idle", "task", "task:a", "activity:b"] as const).map((raw) =>
        conditionLabel(parseCondition(raw)),
      ),
    ).toEqual(["idle", "task", "task:a", "activity:b"])
  })
})

describe("measure and decide", () => {
  const probe = { id: "p1", ended: false, tree: ["p1", "c1"] }

  it("counts what the conditions need, then the incidents", async () => {
    const port = fakePort({
      getJobsCount: () => ({ count: 0 }),
      getTasksCount: (input) => ({ count: input.query.taskDefinitionKey === "approve" ? 1 : 0 }),
      getProcessInstancesCount: (input) => ({
        count: input.query.withIncident === "true" ? 2 : 0,
      }),
      getHistoricActivityInstancesCount: (input) => ({
        count: input.query.processInstanceId === "c1" ? 1 : 0,
      }),
    })
    const conditions: Condition[] = [
      { kind: "idle" },
      { kind: "task", key: "approve" },
      { kind: "task" },
      { kind: "activity", id: "book" },
      { kind: "ended" },
      { kind: "incident" },
    ]
    const measured = await measure(port, probe, conditions, true)
    expect(measured).toEqual({ incidents: 2, held: ["idle", "task:approve", "activity:book"] })
    expect(port.calls.at(-1)?.input.query.withIncident).toBe("true")
    expect(await measure(port, probe, [], false)).toEqual({ incidents: 0, held: [] })
  })

  it("decides incident first, then fail fast, then the first condition, then the end", () => {
    const quiet = { incidents: 0, held: [] }
    const incident = { incidents: 1, held: ["idle"] }
    expect(decide([{ kind: "incident" }], true, probe, incident)).toEqual({
      kind: "held",
      until: "incident",
    })
    expect(decide([{ kind: "idle" }], true, probe, incident)).toEqual({ kind: "incident" })
    expect(decide([{ kind: "idle" }], false, probe, incident)).toEqual({
      kind: "held",
      until: "idle",
    })
    expect(decide([], false, { ...probe, ended: true }, quiet)).toEqual({ kind: "ended" })
    expect(decide([], false, probe, quiet)).toEqual({ kind: "pending" })
  })
})
