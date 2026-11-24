import { RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { instructionReportsOf, migrationPlanOf } from "./migration-rows.js"

const PLAN = { sourceProcessDefinitionId: "order:1:a", targetProcessDefinitionId: "order:2:b" }

function failureOf(read: () => unknown): unknown {
  try {
    read()
  } catch (error: unknown) {
    return error
  }
  return undefined
}

describe("migrationPlanOf", () => {
  it("reads the versions and each instruction's activities", () => {
    expect(
      migrationPlanOf({
        ...PLAN,
        instructions: [
          { sourceActivityIds: ["a"], targetActivityIds: ["b", "c"], updateEventTrigger: false },
        ],
      }),
    ).toStrictEqual({
      ...PLAN,
      instructions: [{ sourceActivityIds: ["a"], targetActivityIds: ["b", "c"] }],
    })
  })

  it.each([
    ["no object", [], "migration plan is not an object"],
    [
      "no source version",
      { targetProcessDefinitionId: "x" },
      "sourceProcessDefinitionId is missing",
    ],
    [
      "no target version",
      { sourceProcessDefinitionId: "x" },
      "targetProcessDefinitionId is missing",
    ],
    [
      "an instruction without its sources",
      { ...PLAN, instructions: [{ targetActivityIds: ["b"] }] },
      "sourceActivityIds is missing",
    ],
    [
      "an instruction without its targets",
      { ...PLAN, instructions: [{ sourceActivityIds: ["a"], targetActivityIds: null }] },
      "targetActivityIds is missing",
    ],
  ])("fails a plan with %s as unexpected", (_name, answer, message) => {
    const error = failureOf(() => migrationPlanOf(answer))

    expect(error).toBeInstanceOf(RuntimeError)
    expect(error).toMatchObject({ failure: "unexpectedResponse", message })
  })
})

describe("instructionReportsOf", () => {
  it("reads each report's instruction and failures", () => {
    expect(
      instructionReportsOf({
        instructionReports: [
          {
            instruction: { sourceActivityIds: ["a"], targetActivityIds: ["b"] },
            failures: ["no"],
          },
          { instruction: { sourceActivityIds: [], targetActivityIds: [] }, failures: null },
        ],
      }),
    ).toStrictEqual([
      { instruction: { sourceActivityIds: ["a"], targetActivityIds: ["b"] }, failures: ["no"] },
      { instruction: { sourceActivityIds: [], targetActivityIds: [] }, failures: [] },
    ])
  })

  it.each([
    ["no object", "report", "migration plan report is not an object"],
    [
      "a report without its instruction",
      { instructionReports: [{}] },
      "instruction is not an object",
    ],
    [
      "an instruction without its sources",
      { instructionReports: [{ instruction: { targetActivityIds: [] } }] },
      "sourceActivityIds is missing",
    ],
  ])("fails a report with %s as unexpected", (_name, answer, message) => {
    expect(failureOf(() => instructionReportsOf(answer))).toMatchObject({
      failure: "unexpectedResponse",
      message,
    })
  })
})
