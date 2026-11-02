import { describe, expect, it } from "vitest"
import { coerceValue, isEditableVariable } from "./lib/coerce-value.js"

describe("coerceValue", () => {
  it("passes strings through and parses booleans strictly", () => {
    expect(coerceValue("hello", "String")).toBe("hello")
    expect(coerceValue("true", "Boolean")).toBe(true)
    expect(coerceValue("yes", "Boolean")).toBeUndefined()
  })

  it("parses in-range Long/Integer values", () => {
    expect(coerceValue("42", "Long")).toBe(42)
    expect(coerceValue("-7", "Integer")).toBe(-7)
    expect(coerceValue("9007199254740991", "Long")).toBe(Number.MAX_SAFE_INTEGER)
  })

  it("refuses Long values beyond 2^53 instead of silently rounding", () => {
    // Number("9007199254740993") === 9007199254740992 — writing that to the
    // engine would corrupt the variable without any operator-visible error.
    expect(coerceValue("9007199254740993", "Long")).toBeUndefined()
    expect(coerceValue("-9007199254740993", "Long")).toBeUndefined()
    expect(coerceValue("19007199254740993", "Long")).toBeUndefined()
  })

  it("rejects non-integer input for Long", () => {
    expect(coerceValue("1.5", "Long")).toBeUndefined()
    expect(coerceValue("abc", "Long")).toBeUndefined()
  })
})

describe("coerceValue for the engine's serialized and date types", () => {
  it("validates Json/Object input but keeps the string — the engine takes no parsed object", () => {
    expect(coerceValue('{"a":[1,2]}', "Json")).toBe('{"a":[1,2]}')
    expect(coerceValue("[1,2]", "Object")).toBe("[1,2]")
    expect(coerceValue("{a:", "Json")).toBeUndefined()
  })

  it("accepts an ISO 8601 date or date-time with offset and refuses the rest", () => {
    for (const ok of ["2026-10-01", "2026-10-01T08:30:00Z", "2026-09-30T22:00:00.000+0000"]) {
      expect(coerceValue(ok, "Date")).toBe(ok)
    }
    for (const bad of ["01.10.2026", "2026-10-01T08:30:00", "2026-13-45", "tomorrow"]) {
      expect(coerceValue(bad, "Date")).toBeUndefined()
    }
  })
})

describe("isEditableVariable", () => {
  it("offers Edit for text values and JSON-serialized Objects only", () => {
    expect(isEditableVariable({ type: "String" })).toBe(true)
    expect(isEditableVariable({ type: "Json" })).toBe(true)
    expect(isEditableVariable({})).toBe(true)
    expect(isEditableVariable({ type: "File" })).toBe(false)
    expect(isEditableVariable({ type: "Bytes" })).toBe(false)
    expect(
      isEditableVariable({
        type: "Object",
        valueInfo: { serializationDataFormat: "application/json" },
      }),
    ).toBe(true)
    expect(isEditableVariable({ type: "Object" })).toBe(false)
  })
})
