import { describe, expect, test } from "vitest"
import { DefinitionId, IsoTimestamp, type VariableCondition } from "../../../src/contract/index.js"
import { fakeRuntime } from "./support/fake-engine.js"
import type { FakeEngineRest, RestRoute } from "./support/fake-engine-rest.js"
import { fixture } from "./support/fixtures.js"

const NO_INSTANCES: RestRoute = { route: "POST /history/process-instance", answer: [] }
const COUNTED: RestRoute = { route: "POST /history/process-instance/count", answer: { count: 3 } }

function variablesSent(engine: FakeEngineRest): unknown {
  const body = JSON.parse(engine.requests[0]?.body ?? "{}") as { variables?: unknown }
  return body.variables
}

async function searched(conditions: readonly VariableCondition[]): Promise<unknown> {
  const { runtime, engine } = fakeRuntime([NO_INSTANCES])
  await runtime.searchInstances({ variables: conditions }, { limit: 5 })
  return variablesSent(engine)
}

describe("the C7 variable search", () => {
  test.each([
    ["equals", "eq"],
    ["notEquals", "neq"],
    ["greaterThan", "gt"],
    ["lessThan", "lt"],
  ] as const)("maps %s to %s with the typed value", async (operator, engineOperator) => {
    expect(await searched([{ name: "amount", operator, valueJson: "42" }])).toEqual([
      { name: "amount", operator: engineOperator, value: 42 },
    ])
  })

  test("keeps text and booleans typed", async () => {
    expect(
      await searched([
        { name: "route", operator: "equals", valueJson: '"42"' },
        { name: "express", operator: "equals", valueJson: "true" },
      ]),
    ).toEqual([
      { name: "route", operator: "eq", value: "42" },
      { name: "express", operator: "eq", value: true },
    ])
  })

  test("sends a date in the engine's date format and null as null", async () => {
    expect(
      await searched([
        { name: "dueAt", operator: "greaterThan", at: IsoTimestamp("2026-03-15T11:00:00+01:00") },
        { name: "giftNote", operator: "equals", valueJson: "null" },
      ]),
    ).toEqual([
      { name: "dueAt", operator: "gt", value: "2026-03-15T10:00:00.000+0000" },
      { name: "giftNote", operator: "eq", value: null },
    ])
  })

  test("sends an integer beyond 2^53 exactly", async () => {
    const { runtime, engine } = fakeRuntime([NO_INSTANCES])
    await runtime.searchInstances(
      { variables: [{ name: "orderNumber", operator: "equals", valueJson: "9007199254740993" }] },
      { limit: 5 },
    )
    expect(engine.requests[0]?.body).toContain('"value":9007199254740993')
  })

  test("turns * into the engine wildcard and escapes the engine's own wildcards", async () => {
    expect(await searched([{ name: "code", operator: "like", pattern: "A*_5%\\b*" }])).toEqual([
      { name: "code", operator: "like", value: "A%\\_5\\%\\\\b%" },
    ])
  })

  test("counts with the same conditions", async () => {
    const { runtime, engine } = fakeRuntime([COUNTED])
    const conditions: VariableCondition[] = [{ name: "route", operator: "like", pattern: "rev*" }]
    expect(await runtime.countInstances({ variables: conditions })).toBe(3)
    expect(variablesSent(engine)).toEqual([{ name: "route", operator: "like", value: "rev%" }])
  })
})

describe("the C7 variable names", () => {
  test("names the variables of the newest instances of a version once each, sorted", async () => {
    const instances = JSON.parse(fixture("historic-instances-order.json")) as { id: string }[]
    const { runtime, engine } = fakeRuntime([
      { route: "POST /history/process-instance", answer: instances },
      {
        route: "POST /history/variable-instance",
        answer: ["route", "amount", "route", "reviewNote"].map((name) => ({
          name,
          type: "String",
        })),
      },
    ])

    expect(await runtime.listVariableNames(DefinitionId("order:1"))).toEqual([
      "amount",
      "reviewNote",
      "route",
    ])
    expect(JSON.parse(engine.requests[0]?.body ?? "{}") as unknown).toMatchObject({
      processDefinitionId: "order:1",
    })
    expect(engine.requests[0]?.query).toMatchObject({ maxResults: "50" })
    expect(JSON.parse(engine.requests[1]?.body ?? "{}") as unknown).toEqual({
      processInstanceIdIn: instances.map((instance) => instance.id),
    })
    expect(engine.requests[1]?.query).toMatchObject({ deserializeValues: "false" })
  })

  test("asks for no variables when the version has no instances", async () => {
    const { runtime, engine } = fakeRuntime([NO_INSTANCES])

    expect(await runtime.listVariableNames(DefinitionId("order:9"))).toEqual([])
    expect(engine.requests).toHaveLength(1)
  })
})
