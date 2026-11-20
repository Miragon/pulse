import { describe, expect, test } from "vitest"
import { VariableConditionTypes, type VariableConditionData } from "../../src/index.js"

const condition = (changes: Partial<VariableConditionData>): VariableConditionData => ({
  name: "v",
  operator: "equals",
  value: "",
  ...changes,
})

describe("the type of a variable condition's value", () => {
  test("is the type named, before anything the operator or the value implies", () => {
    expect(VariableConditionTypes.of(condition({ as: "date", operator: "greaterThan" }))).toBe(
      "date",
    )
    expect(VariableConditionTypes.of(condition({ as: "text", value: "42" }))).toBe("text")
  })

  test("is text for a pattern and a number for an ordering, whatever the value", () => {
    expect(VariableConditionTypes.of(condition({ operator: "like", value: "42" }))).toBe("text")
    expect(VariableConditionTypes.of(condition({ operator: "greaterThan", value: "x" }))).toBe(
      "number",
    )
    expect(VariableConditionTypes.of(condition({ operator: "lessThan", value: "x" }))).toBe(
      "number",
    )
  })

  test.each([
    ["42", "number"],
    ["7", "number"],
    ["100", "number"],
    ["-0.5", "number"],
    ["0.25", "number"],
    ["0", "number"],
    ["007", "text"],
    ["1.", "text"],
    ["1e3", "text"],
    [" 42", "text"],
    ["42 ", "text"],
    ["true", "boolean"],
    ["false", "boolean"],
    ["True", "text"],
    ["", "text"],
  ] as const)("reads %j compared for equality as %s", (value, type) => {
    expect(VariableConditionTypes.of(condition({ value }))).toBe(type)
    expect(VariableConditionTypes.of(condition({ operator: "notEquals", value }))).toBe(type)
  })
})
