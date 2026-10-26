import { describe, expect, test } from "vitest"
import { IsoTimestamp, type VariableCondition } from "../../../src/contract/index.js"
import { fakeRuntime, type FakeEngineCli } from "./support/fake-engine-cli.js"

const NO_INSTANCES = { command: ["historic-process-instance", "query"], stdout: "[]" }
const COUNTED = { command: ["historic-process-instance", "query-count"], stdout: '{"count":3}' }

function variablesSent(cli: FakeEngineCli): unknown {
  const body = JSON.parse(cli.invocations[0]?.input ?? "{}") as { variables?: unknown }
  return body.variables
}

async function searched(conditions: readonly VariableCondition[]): Promise<unknown> {
  const { runtime, cli } = fakeRuntime([NO_INSTANCES])
  await runtime.searchInstances({ variables: conditions }, { limit: 5 })
  return variablesSent(cli)
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
    const { runtime, cli } = fakeRuntime([NO_INSTANCES])
    await runtime.searchInstances(
      { variables: [{ name: "orderNumber", operator: "equals", valueJson: "9007199254740993" }] },
      { limit: 5 },
    )
    expect(cli.invocations[0]?.input).toContain('"value":9007199254740993')
  })

  test("turns * into the engine wildcard and escapes the engine's own wildcards", async () => {
    expect(await searched([{ name: "code", operator: "like", pattern: "A*_5%\\b*" }])).toEqual([
      { name: "code", operator: "like", value: "A%\\_5\\%\\\\b%" },
    ])
  })

  test("counts with the same conditions", async () => {
    const { runtime, cli } = fakeRuntime([COUNTED])
    const conditions: VariableCondition[] = [{ name: "route", operator: "like", pattern: "rev*" }]
    expect(await runtime.countInstances({ variables: conditions })).toBe(3)
    expect(variablesSent(cli)).toEqual([{ name: "route", operator: "like", value: "rev%" }])
  })
})
