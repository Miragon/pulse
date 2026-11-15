import { DefinitionId, ElementId, type MigrationPlan } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { fakePort, type Route } from "../testing/fake-port.js"
import { MigrationReader } from "./migration-reader.js"

const SOURCE = DefinitionId("pulse-order:1:8d0fb34a-cf22-11f1-abf2-ce3814910ef6")
const TARGET = DefinitionId("pulse-order:3:8d1c0f62-cf22-11f1-abf2-ce3814910ef6")
const REVIEW = ElementId("Activity_ReviewOrder")
const CHARGE = ElementId("Activity_ChargePayment")
const INCOMPATIBLE =
  "Activities have incompatible types (UserTaskActivityBehavior is not compatible with ServiceTaskExpressionActivityBehavior)"

const PLAN: MigrationPlan = {
  sourceDefinitionId: SOURCE,
  targetDefinitionId: TARGET,
  mappings: [{ sourceElementId: CHARGE, targetElementId: CHARGE }],
}

function readerOver(routes: Readonly<Record<string, Route>>) {
  const port = fakePort(routes)
  return { port, reader: new MigrationReader(port) }
}

function instruction(sources: readonly string[], targets: readonly string[]) {
  return { sourceActivityIds: sources, targetActivityIds: targets, updateEventTrigger: false }
}

describe("MigrationReader.proposal", () => {
  it("lets the engine generate the plan without changing event triggers", async () => {
    const { port, reader } = readerOver({
      generateMigrationPlan: () => ({
        sourceProcessDefinitionId: SOURCE,
        targetProcessDefinitionId: TARGET,
        instructions: [instruction([CHARGE], [CHARGE]), instruction(["A", "B"], ["C"])],
        variables: null,
      }),
    })

    expect(await reader.proposal(SOURCE, TARGET)).toStrictEqual(PLAN)
    expect(port.calls).toStrictEqual([
      {
        operationId: "generateMigrationPlan",
        input: {
          pathArgs: [],
          query: {},
          body: {
            sourceProcessDefinitionId: SOURCE,
            targetProcessDefinitionId: TARGET,
            updateEventTriggers: false,
          },
        },
      },
    ])
  })

  it.each([
    ["no source", [], [CHARGE]],
    ["no target", [CHARGE], []],
    ["two sources", [CHARGE, REVIEW], [CHARGE]],
    ["two targets", [CHARGE], [CHARGE, REVIEW]],
  ])("leaves out an instruction with %s", async (_name, sources, targets) => {
    const { reader } = readerOver({
      generateMigrationPlan: () => ({
        sourceProcessDefinitionId: SOURCE,
        targetProcessDefinitionId: TARGET,
        instructions: [instruction(sources, targets)],
      }),
    })

    expect((await reader.proposal(SOURCE, TARGET)).mappings).toStrictEqual([])
  })

  it("reads a plan without instructions as one without mappings", async () => {
    const { reader } = readerOver({
      generateMigrationPlan: () => ({
        sourceProcessDefinitionId: SOURCE,
        targetProcessDefinitionId: TARGET,
      }),
    })

    expect(await reader.proposal(SOURCE, TARGET)).toStrictEqual({ ...PLAN, mappings: [] })
  })
})

describe("MigrationReader.check", () => {
  it("names the mapping of every failure the engine reports", async () => {
    const { port, reader } = readerOver({
      validateMigrationPlan: () => ({
        instructionReports: [
          { instruction: instruction([REVIEW], [CHARGE]), failures: [INCOMPATIBLE, "second"] },
        ],
        variableReports: {},
      }),
    })
    const plan = { ...PLAN, mappings: [{ sourceElementId: REVIEW, targetElementId: CHARGE }] }

    expect(await reader.check(plan)).toStrictEqual({
      problems: [
        { mapping: { sourceElementId: REVIEW, targetElementId: CHARGE }, message: INCOMPATIBLE },
        { mapping: { sourceElementId: REVIEW, targetElementId: CHARGE }, message: "second" },
      ],
    })
    expect(port.calls).toStrictEqual([
      {
        operationId: "validateMigrationPlan",
        input: {
          pathArgs: [],
          query: {},
          body: {
            sourceProcessDefinitionId: SOURCE,
            targetProcessDefinitionId: TARGET,
            instructions: [instruction([REVIEW], [CHARGE])],
          },
        },
      },
    ])
    expect(JSON.stringify(port.calls[0]?.input.body)).toBe(
      `{"sourceProcessDefinitionId":"${SOURCE}","targetProcessDefinitionId":"${TARGET}","instructions":[{"sourceActivityIds":["${REVIEW}"],"targetActivityIds":["${CHARGE}"],"updateEventTrigger":false}]}`,
    )
  })

  it("names no mapping for a failure of an instruction that maps none", async () => {
    const { reader } = readerOver({
      validateMigrationPlan: () => ({
        instructionReports: [
          { instruction: instruction([REVIEW, CHARGE], [CHARGE]), failures: ["x"] },
        ],
      }),
    })

    expect(await reader.check(PLAN)).toStrictEqual({ problems: [{ message: "x" }] })
  })

  it.each([
    ["the engine lists none", { instructionReports: [], variableReports: {} }],
    ["the report has no instruction reports", {}],
    [
      "an instruction report has no failures",
      { instructionReports: [{ instruction: instruction([REVIEW], [CHARGE]) }] },
    ],
  ])("has no problems when %s", async (_name, report) => {
    const { reader } = readerOver({ validateMigrationPlan: () => report })

    expect(await reader.check(PLAN)).toStrictEqual({ problems: [] })
  })
})
