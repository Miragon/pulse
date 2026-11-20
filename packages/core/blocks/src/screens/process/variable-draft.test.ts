import { describe, expect, it } from "vitest"
import { VariableDraft, type VariableDraftData } from "./variable-draft.js"

function draft(change: Partial<VariableDraftData> = {}): VariableDraftData {
  return { name: "amount", operator: "equals", value: "4", compareAs: "auto", ...change }
}

describe("the rules of the variable condition dialog", () => {
  it("start from a condition, or from an empty one", () => {
    expect(VariableDraft.from(undefined)).toEqual({
      name: "",
      operator: "equals",
      value: "",
      compareAs: "auto",
    })
    expect(
      VariableDraft.from({
        name: "dueAt",
        operator: "lessThan",
        value: "2026-03-15T10:00",
        as: "date",
      }),
    ).toEqual({ name: "dueAt", operator: "lessThan", value: "2026-03-15T10:00", compareAs: "date" })
  })

  it("offer every way of comparing and the operators of each", () => {
    expect(VariableDraft.compareAsOptions()).toEqual([
      "auto",
      "text",
      "number",
      "boolean",
      "date",
      "null",
    ])
    expect(VariableDraft.operatorsOf("text")).toEqual(["equals", "notEquals", "like"])
    expect(VariableDraft.operatorsOf("null")).toEqual(VariableDraft.OPERATORS_OF.null)
  })

  it("name the kind an engine refuses: a date, and greater or less than on anything but a date", () => {
    expect(VariableDraft.refusedKind("date", undefined, ["date"])).toBe("date")
    expect(VariableDraft.refusedKind("date", "greaterThan", ["ordering"])).toBeUndefined()
    expect(VariableDraft.refusedKind("number", "lessThan", ["ordering"])).toBe("ordering")
    expect(VariableDraft.refusedKind("auto", "greaterThan", ["date"])).toBeUndefined()
    expect(VariableDraft.refusedKind("auto", "equals", ["ordering"])).toBeUndefined()
    expect(VariableDraft.refusedKind("auto", undefined, ["ordering", "date"])).toBeUndefined()
  })

  it("keep the operator a type offers when the type changes, else is", () => {
    const greater = draft({ operator: "greaterThan" })
    expect(VariableDraft.withCompareAs(greater, "text")).toMatchObject({ operator: "equals" })
    expect(VariableDraft.withCompareAs(greater, "number")).toMatchObject({
      operator: "greaterThan",
      value: "4",
    })
    expect(VariableDraft.withCompareAs(greater, "number", ["ordering"])).toMatchObject({
      operator: "equals",
    })
    expect(VariableDraft.withCompareAs(greater, "date", ["ordering"])).toMatchObject({
      operator: "greaterThan",
      value: "",
    })
  })

  it("keep a value where it fits the new type", () => {
    expect(VariableDraft.withCompareAs(draft({ value: "false" }), "boolean").value).toBe("false")
    expect(VariableDraft.withCompareAs(draft({ value: "maybe" }), "boolean").value).toBe("true")
    expect(VariableDraft.withCompareAs(draft(), "null").value).toBe("")
    expect(VariableDraft.withCompareAs(draft({ value: "2026-03-15T10:00" }), "date").value).toBe(
      "2026-03-15T10:00",
    )
  })

  it("make a condition of a draft, its name trimmed, its type only where one is named", () => {
    expect(VariableDraft.condition(draft({ name: " amount " }))).toEqual({
      name: "amount",
      operator: "equals",
      value: "4",
    })
    expect(VariableDraft.condition(draft({ compareAs: "number" }))).toEqual({
      name: "amount",
      operator: "equals",
      value: "4",
      as: "number",
    })
  })

  it.each([
    [draft({ operator: "greaterThan", value: "abc" }), { value: "number" }],
    [draft({ compareAs: "number", value: "4x" }), { value: "number" }],
    [draft({ value: "abc" }), {}],
    [draft({ name: "  ", compareAs: "text" }), { name: "missing" }],
    [draft({ compareAs: "date", operator: "lessThan", value: "" }), { value: "date" }],
    [draft({ compareAs: "date", value: "2026-03-15T10:00" }), {}],
    [draft({ compareAs: "null", value: "" }), {}],
  ] as const)("find in %o what is wrong: %o", (wrong, errors) => {
    expect(VariableDraft.errors(wrong, 0)).toEqual(errors)
  })

  it("refuse a sixth condition and a kind the engine refuses", () => {
    expect(VariableDraft.errors(draft(), 5)).toEqual({ count: "tooMany" })
    expect(VariableDraft.errors(draft({ operator: "lessThan" }), 0, ["ordering"])).toEqual({
      refused: "ordering",
    })
    expect(
      VariableDraft.errors(draft({ compareAs: "date", value: "2026-03-15T10:00" }), 0, ["date"]),
    ).toEqual({ refused: "date" })
  })

  it("read numbers and dates as the engine takes them", () => {
    const number = new RegExp(`^${VariableDraft.NUMBER_PATTERN}$`)
    const date = new RegExp(`^${VariableDraft.DATE_PATTERN}$`)
    expect(["42", "-9.5", "0"].every((value) => number.test(value))).toBe(true)
    expect(["042", "1e3", "4."].some((value) => number.test(value))).toBe(false)
    expect(date.test("2026-03-15T10:00:30")).toBe(true)
    expect(date.test("2026-03-15 10:00")).toBe(false)
    expect(VariableDraft.MAX_CONDITIONS).toBe(5)
  })
})
