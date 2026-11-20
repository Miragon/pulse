import { DefinitionId } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { InstanceQuery } from "../../src/builder/index.js"
import type { VariableConditionData } from "../../src/index.js"

const VERSION = DefinitionId("order:2")

describe("the query of an instance list", () => {
  test.each([
    ["running", { lifecycle: "running" }],
    ["withIncident", { lifecycle: "running", withIncident: true }],
    ["ended", { lifecycle: "ended" }],
    ["all", {}],
  ] as const)("asks the engine for the scope %s of the version", (scope, asked) => {
    expect(InstanceQuery.of(VERSION, { scope })).toStrictEqual({ definitionId: VERSION, ...asked })
  })

  test("narrows to the instances active at an element, with the exact business key", () => {
    expect(
      InstanceQuery.of(VERSION, { scope: "all", elementId: "Task_A", businessKey: "ORD-1" }),
    ).toStrictEqual({ definitionId: VERSION, activeElementId: "Task_A", businessKey: "ORD-1" })
  })

  test("asks for each variable condition by its value's type", () => {
    const conditions: VariableConditionData[] = [
      { name: "note", operator: "equals", value: "late" },
      { name: "amount", operator: "greaterThan", value: "42" },
      { name: "paid", operator: "notEquals", value: "true" },
      { name: "code", operator: "equals", value: "007", as: "text" },
      { name: "dueAt", operator: "lessThan", value: "2026-03-15T10:00:00+01:00", as: "date" },
      { name: "gift", operator: "equals", value: "", as: "null" },
      { name: "city", operator: "like", value: "Mun%" },
    ]

    expect(InstanceQuery.of(VERSION, { scope: "running", variables: conditions })).toStrictEqual({
      definitionId: VERSION,
      lifecycle: "running",
      variables: [
        { name: "note", operator: "equals", valueJson: '"late"' },
        { name: "amount", operator: "greaterThan", valueJson: "42" },
        { name: "paid", operator: "notEquals", valueJson: "true" },
        { name: "code", operator: "equals", valueJson: '"007"' },
        { name: "dueAt", operator: "lessThan", at: "2026-03-15T09:00:00.000Z" },
        { name: "gift", operator: "equals", valueJson: "null" },
        { name: "city", operator: "like", pattern: "Mun%" },
      ],
    })
  })

  test.each([
    ["2026-03-15T10:00Z", "2026-03-15T10:00:00.000Z"],
    ["2026-03-15T10:00:30.250-05:00", "2026-03-15T15:00:30.250Z"],
  ])("asks for a date with its offset as the instant it names: %s", (value, at) => {
    expect(
      InstanceQuery.conditionOf({ name: "dueAt", operator: "greaterThan", value, as: "date" }),
    ).toStrictEqual({ name: "dueAt", operator: "greaterThan", at })
  })

  test.each([
    "2026-03-15T10:00",
    "2026-03-15T10:00:00",
    "2026-03-15T10:00+0100",
    "2026-03-15T10:00+01:00 ",
  ])("refuses a date without an offset, read in no time zone of its own: %j", (value) => {
    expect(() =>
      InstanceQuery.of(VERSION, {
        scope: "running",
        variables: [{ name: "dueAt", operator: "lessThan", value, as: "date" }],
      }),
    ).toThrow(
      new RangeError(
        `The date "${value}" names no offset; the surface reads its user's time zone into it`,
      ),
    )
  })

  test("refuses an offset on a text that names no time", () => {
    expect(() =>
      InstanceQuery.conditionOf({
        name: "dueAt",
        operator: "equals",
        value: "soon+01:00",
        as: "date",
      }),
    ).toThrow('"soon+01:00" is not a timestamp')
  })
})
