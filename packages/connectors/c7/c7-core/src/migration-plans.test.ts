import { RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { isWorkflowError, type WorkflowErrorReason } from "./errors.js"
import {
  checkMigrationPlan,
  definitionsAtVersion,
  definitionsAtVersionRequest,
  elementPairOf,
  migrationInstructions,
  type PlannedMigration,
  proposeMigrationPlan,
  readProblems,
  readProposal,
} from "./migration-plans.js"
import { fakeFailure, fakePort, type Route } from "./testing/fake-port.js"

const SOURCE = "invoice:1:def-1"
const TARGET = "invoice:2:def-2"
const PLAN: PlannedMigration = {
  sourceDefinitionId: SOURCE,
  targetDefinitionId: TARGET,
  mappings: [
    { sourceElementId: "approve", targetElementId: "approve" },
    { sourceElementId: "check", targetElementId: "review" },
  ],
}

function instruction(sources: readonly string[], targets: readonly string[]) {
  return { sourceActivityIds: sources, targetActivityIds: targets, updateEventTrigger: false }
}

function definition(version: number, id: string, tenantId?: string | null) {
  return { id, key: "invoice", version, ...(tenantId === undefined ? {} : { tenantId }) }
}

async function reasonOf(promise: Promise<unknown>): Promise<WorkflowErrorReason> {
  const error: unknown = await promise.then(
    () => undefined,
    (rejection: unknown) => rejection,
  )
  if (isWorkflowError(error)) return error.reason
  throw new Error("the promise did not reject with a WorkflowError")
}

describe("definitionsAtVersionRequest", () => {
  it.each([
    [3, { key: "invoice", version: "3", firstResult: "0", maxResults: "11" }],
    [
      "latest" as const,
      { key: "invoice", latestVersion: "true", firstResult: "0", maxResults: "11" },
    ],
  ])("asks for the definitions at %s, one more than 10", (version, query) => {
    expect(definitionsAtVersionRequest("invoice", version)).toStrictEqual({
      operationId: "getProcessDefinitions",
      input: { pathArgs: [], query },
    })
  })

  it.each([3, "latest" as const])("is the request definitionsAtVersion sends for %s", async (v) => {
    const port = fakePort({ getProcessDefinitions: () => [] })

    await definitionsAtVersion(port, "invoice", v)

    expect(port.calls).toStrictEqual([definitionsAtVersionRequest("invoice", v)])
  })
})

describe("definitionsAtVersion", () => {
  it("reads each definition's id, version and tenant, a missing tenant left out", async () => {
    const port = fakePort({
      getProcessDefinitions: () => [
        definition(2, "invoice:2:a", "acme"),
        definition(2, "invoice:2:b", null),
        definition(2, "invoice:2:c"),
      ],
    })

    expect(await definitionsAtVersion(port, "invoice", 2)).toStrictEqual({
      definitions: [
        { id: "invoice:2:a", version: 2, tenantId: "acme" },
        { id: "invoice:2:b", version: 2 },
        { id: "invoice:2:c", version: 2 },
      ],
      more: false,
    })
  })

  it("reads the latest version of each tenant", async () => {
    const port = fakePort({
      getProcessDefinitions: (input) =>
        input.query.latestVersion === "true" ? [definition(4, "invoice:4:a")] : [],
    })

    expect(await definitionsAtVersion(port, "invoice", "latest")).toStrictEqual({
      definitions: [{ id: "invoice:4:a", version: 4 }],
      more: false,
    })
  })

  it("keeps 10 definitions and tells that there are more when the engine answers 11", async () => {
    const rows = Array.from({ length: 11 }, (_, index) =>
      definition(1, `invoice:1:${index}`, `t${index}`),
    )
    const port = fakePort({ getProcessDefinitions: () => rows })

    const { definitions, more } = await definitionsAtVersion(port, "invoice", 1)

    expect(definitions.map((found) => found.tenantId)).toStrictEqual(
      rows.slice(0, 10).map((row) => row.tenantId),
    )
    expect(more).toBe(true)
    expect(port.calls).toHaveLength(1)
  })

  it.each([
    ["no id", { key: "invoice", version: 1 }, "id is missing"],
    ["a version that is no number", { id: "invoice:1:a", version: "1" }, "version is not a number"],
    [
      "a tenant that is no text",
      { ...definition(1, "invoice:1:a"), tenantId: 7 },
      "tenantId is not a string",
    ],
  ])("fails a definition with %s as an unexpected answer", async (_name, row, problem) => {
    const port = fakePort({ getProcessDefinitions: () => [row] })

    expect(await reasonOf(definitionsAtVersion(port, "invoice", 1))).toStrictEqual({
      kind: "unexpected-answer",
      operationId: "getProcessDefinitions",
      problem,
    })
  })
})

describe("migrationInstructions", () => {
  it("writes one instruction per mapping, one activity a side, no event trigger", () => {
    expect(JSON.stringify(migrationInstructions(PLAN.mappings))).toBe(
      '[{"sourceActivityIds":["approve"],"targetActivityIds":["approve"],"updateEventTrigger":false},' +
        '{"sourceActivityIds":["check"],"targetActivityIds":["review"],"updateEventTrigger":false}]',
    )
    expect(migrationInstructions([])).toStrictEqual([])
  })
})

describe("elementPairOf", () => {
  it.each([
    ["no source", [], ["b"]],
    ["no target", ["a"], []],
    ["two sources", ["a", "b"], ["c"]],
    ["two targets", ["a"], ["b", "c"]],
  ])("names no pair for an instruction with %s", (_name, sources, targets) => {
    expect(elementPairOf(instruction(sources, targets))).toBeUndefined()
  })

  it("names the pair of one source and one target", () => {
    expect(
      elementPairOf(instruction(["a#multiInstanceBody"], ["b#multiInstanceBody"])),
    ).toStrictEqual({
      sourceElementId: "a#multiInstanceBody",
      targetElementId: "b#multiInstanceBody",
    })
  })
})

describe("proposeMigrationPlan", () => {
  it("lets the engine generate the plan without changing event triggers and counts what it leaves out", async () => {
    const port = fakePort({
      generateMigrationPlan: () => ({
        sourceProcessDefinitionId: SOURCE,
        targetProcessDefinitionId: TARGET,
        instructions: [
          instruction(["approve"], ["approve"]),
          instruction(["a", "b"], ["c"]),
          instruction(["check"], ["review"]),
          instruction(["d"], []),
        ],
        variables: null,
      }),
    })

    expect(await proposeMigrationPlan(port, SOURCE, TARGET)).toStrictEqual({ ...PLAN, leftOut: 2 })
    expect(JSON.stringify(port.calls)).toBe(
      `[{"operationId":"generateMigrationPlan","input":{"pathArgs":[],"query":{},"body":{"sourceProcessDefinitionId":"${SOURCE}","targetProcessDefinitionId":"${TARGET}","updateEventTriggers":false}}}]`,
    )
  })

  it("reads a plan without instructions as one without mappings", async () => {
    const port = fakePort({
      generateMigrationPlan: () => ({
        sourceProcessDefinitionId: SOURCE,
        targetProcessDefinitionId: TARGET,
      }),
    })

    expect(await proposeMigrationPlan(port, SOURCE, TARGET)).toStrictEqual({
      ...PLAN,
      mappings: [],
      leftOut: 0,
    })
  })

  it("fails an answer it cannot read as an unexpected answer", async () => {
    const port = fakePort({ generateMigrationPlan: () => ({ sourceProcessDefinitionId: SOURCE }) })

    expect(await reasonOf(proposeMigrationPlan(port, SOURCE, TARGET))).toStrictEqual({
      kind: "unexpected-answer",
      operationId: "generateMigrationPlan",
      problem: "targetProcessDefinitionId is missing",
    })
  })
})

describe("checkMigrationPlan", () => {
  it("sends one instruction per mapping and names the mapping of every failure", async () => {
    const port = fakePort({
      validateMigrationPlan: () => ({
        instructionReports: [
          { instruction: instruction(["check"], ["review"]), failures: ["incompatible", "second"] },
          { instruction: instruction(["a", "b"], ["c"]), failures: ["no pair"] },
          { instruction: instruction(["approve"], ["approve"]), failures: null },
        ],
        variableReports: {},
      }),
    })

    expect(await checkMigrationPlan(port, PLAN)).toStrictEqual([
      { mapping: { sourceElementId: "check", targetElementId: "review" }, message: "incompatible" },
      { mapping: { sourceElementId: "check", targetElementId: "review" }, message: "second" },
      { message: "no pair" },
    ])
    expect(JSON.stringify(port.calls)).toBe(
      `[{"operationId":"validateMigrationPlan","input":{"pathArgs":[],"query":{},"body":{"sourceProcessDefinitionId":"${SOURCE}","targetProcessDefinitionId":"${TARGET}","instructions":${JSON.stringify(migrationInstructions(PLAN.mappings))}}}}]`,
    )
  })

  it.each([
    ["the engine lists none", { instructionReports: [], variableReports: {} }],
    ["the report has no instruction reports", {}],
  ])("finds no problem when %s", async (_name, report) => {
    expect(
      await checkMigrationPlan(fakePort({ validateMigrationPlan: () => report }), PLAN),
    ).toStrictEqual([])
  })

  it("checks a plan without mappings", async () => {
    const port = fakePort({ validateMigrationPlan: () => ({}) })

    await checkMigrationPlan(port, { ...PLAN, mappings: [] })

    expect(port.calls[0]?.input.body).toStrictEqual({
      sourceProcessDefinitionId: SOURCE,
      targetProcessDefinitionId: TARGET,
      instructions: [],
    })
  })

  it("fails an answer it cannot read as an unexpected answer", async () => {
    const port = fakePort({ validateMigrationPlan: () => ({ instructionReports: [{}] }) })

    expect(await reasonOf(checkMigrationPlan(port, PLAN))).toStrictEqual({
      kind: "unexpected-answer",
      operationId: "validateMigrationPlan",
      problem: "instruction is not an object",
    })
  })
})

describe("the contract's reads", () => {
  it.each([
    [
      "the proposal",
      (routes: Readonly<Record<string, Route>>) => readProposal(fakePort(routes), SOURCE, TARGET),
    ],
    [
      "the check",
      (routes: Readonly<Record<string, Route>>) => readProblems(fakePort(routes), PLAN),
    ],
  ])("of %s fail an answer they cannot read as unexpectedResponse", async (_name, read) => {
    const answer = () => "no object"
    const error: unknown = await read({
      generateMigrationPlan: answer,
      validateMigrationPlan: answer,
    }).catch((rejection: unknown) => rejection)

    expect(error).toBeInstanceOf(RuntimeError)
    expect(error).toMatchObject({ failure: "unexpectedResponse" })
  })
})

describe("the failures of the port", () => {
  const failures: readonly (readonly [string, () => unknown])[] = [
    ["an engine failure", () => fakeFailure(500, "ProcessEngineException")],
    ["a runtime failure of another kind", () => new RuntimeError("unreachable", "down")],
  ]

  it.each(failures)("pass %s unchanged", async (_name, failure) => {
    const thrown = failure()
    const fail = () => {
      throw thrown
    }
    const port = fakePort({
      getProcessDefinitions: fail,
      generateMigrationPlan: fail,
      validateMigrationPlan: fail,
    })

    await expect(definitionsAtVersion(port, "invoice", 1)).rejects.toBe(thrown)
    await expect(proposeMigrationPlan(port, SOURCE, TARGET)).rejects.toBe(thrown)
    await expect(checkMigrationPlan(port, PLAN)).rejects.toBe(thrown)
  })
})
