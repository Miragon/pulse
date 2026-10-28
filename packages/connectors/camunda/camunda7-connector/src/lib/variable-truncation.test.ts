import { describe, expect, it } from "vitest"
import {
  CUT_VALUE_WRITE_RULE,
  MAX_VARIABLE_VALUE_CHARS,
  truncateVariable,
  truncateVariableMap,
  truncateVariableRows,
  VARIABLE_TRUNCATION_NOTE,
  variableRead,
} from "./variable-truncation.js"

const AT_CAP = "a".repeat(MAX_VARIABLE_VALUE_CHARS)
const OVER = `${AT_CAP}b`

describe("truncateVariable", () => {
  it("keeps a value at the cap whole and unmarked", () => {
    const variable = { value: AT_CAP, type: "String" }
    expect(truncateVariable(variable)).toBe(variable)
  })

  it("cuts a value over the cap and marks it with the full length", () => {
    expect(truncateVariable({ value: OVER, type: "Json", valueInfo: {} })).toEqual({
      value: AT_CAP,
      type: "Json",
      valueInfo: {},
      truncated: true,
      valueLength: MAX_VARIABLE_VALUE_CHARS + 1,
    })
  })

  it.each([42, true, null, undefined, { nested: "x".repeat(5000) }])(
    "leaves a non-string value (%j) alone",
    (value) => {
      const variable = { value }
      expect(truncateVariable(variable)).toBe(variable)
    },
  )
})

describe("truncateVariableMap / truncateVariableRows", () => {
  it("bounds every entry of a runtime variable map", () => {
    expect(truncateVariableMap({ big: { value: OVER }, small: { value: "s" } })).toEqual({
      big: { value: AT_CAP, truncated: true, valueLength: OVER.length },
      small: { value: "s" },
    })
  })

  it("bounds every row of a page, passing non-rows and non-arrays through", () => {
    expect(truncateVariableRows([{ name: "big", value: OVER }, null, "x"])).toEqual([
      { name: "big", value: AT_CAP, truncated: true, valueLength: OVER.length },
      null,
      "x",
    ])
    expect(truncateVariableRows({ not: "a page" })).toEqual({ not: "a page" })
  })

  it("the description note names the cap and the marker", () => {
    expect(VARIABLE_TRUNCATION_NOTE).toBe(
      "String values over 2000 chars are cut (truncated: true, valueLength = full size).",
    )
  })
})

describe("variableRead", () => {
  const variables = { big: { value: OVER, type: "Json" }, small: { value: "s" } }

  it("without a name, bounds every value like truncateVariableMap", () => {
    expect(variableRead(variables)).toEqual(truncateVariableMap(variables))
    expect(variableRead(variables).big).toMatchObject({ truncated: true })
  })

  it("with a name, returns only that variable — whole and unmarked", () => {
    const read = variableRead(variables, "big")
    expect(read).toEqual({ big: { value: OVER, type: "Json" } })
    expect(read.big).toBe(variables.big)
  })

  it.each(["missing", "constructor", "__proto__"])(
    "fails for a name the read does not hold (%s) instead of an empty map",
    (name) => {
      expect(() => variableRead(variables, name)).toThrow(
        `No variable named "${name}" — omit variableName to list them all.`,
      )
    },
  )

  it("the write rule forbids sending a cut value back and names the whole read", () => {
    expect(CUT_VALUE_WRITE_RULE).toBe(
      "Never write back a value read with truncated: true — it is incomplete; read it whole first (variableName).",
    )
  })
})
