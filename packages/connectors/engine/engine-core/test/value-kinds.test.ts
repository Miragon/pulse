import { describe, expect, test } from "vitest"
import { ValueKinds } from "../src/index.js"

describe("ValueKinds.ofJson", () => {
  test.each([
    ['"text"', "string"],
    ['"', "string"],
    ['"unclosed', "string"],
    [' "padded" ', "string"],
    ["42", "integer"],
    ["-7", "integer"],
    [" 42 ", "integer"],
    ["4.5", "decimal"],
    ["-4.5e3", "decimal"],
    ["12.25", "decimal"],
    ["1e10", "decimal"],
    ["1E+5", "decimal"],
    ["2.5e-3", "decimal"],
    ["true", "boolean"],
    ["false", "boolean"],
    [" false ", "boolean"],
    ["null", "null"],
    ['{"a":1}', "json"],
    ["[1]", "json"],
  ])("%j is %s", (valueJson, kind) => {
    expect(ValueKinds.ofJson(valueJson)).toBe(kind)
  })

  test.each([
    'closed"',
    "x1",
    "x1.5",
    "1x",
    "1.5x",
    "1.",
    ".5",
    "+1",
    "--1",
    "-",
    "1e",
    "1e+",
    "1.5e",
    "0x1F",
    "1,5",
    "1 000",
    "True",
    "",
  ])("%j only looks like a number, a string or a literal: json", (valueJson) => {
    expect(ValueKinds.ofJson(valueJson)).toBe("json")
  })
})

describe("ValueKinds.isWholeNumber", () => {
  test("holds the range of a 64-bit signed integer", () => {
    expect(ValueKinds.WHOLE_NUMBER_MIN).toBe(-9223372036854775808n)
    expect(ValueKinds.WHOLE_NUMBER_MAX).toBe(9223372036854775807n)
  })

  test.each([
    "9223372036854775807",
    "-9223372036854775808",
    "9223372036854775806",
    "-9223372036854775807",
    "0",
    "-0",
    "42",
    "-7",
    " 9223372036854775807 ",
    "\n-9223372036854775808\t",
    "0009223372036854775807",
    "-0009223372036854775808",
    "007",
    "-00",
  ])("%j is a whole number in range", (valueJson) => {
    expect(ValueKinds.isWholeNumber(valueJson)).toBe(true)
    expect(ValueKinds.ofJson(valueJson)).toBe("integer")
  })

  test.each([
    "9223372036854775808",
    "-9223372036854775809",
    "0009223372036854775808",
    "-0009223372036854775809",
    " 9223372036854775808 ",
    "18446744073709551615",
    "-18446744073709551616",
    "92233720368547758070",
    `1${"0".repeat(400)}`,
  ])("%j is an integer beyond the range", (valueJson) => {
    expect(ValueKinds.isWholeNumber(valueJson)).toBe(false)
    expect(ValueKinds.ofJson(valueJson)).toBe("integer")
  })

  test.each([
    "+1",
    "+9223372036854775807",
    "--1",
    "-",
    "",
    " ",
    "1.0",
    "1.5",
    "9223372036854775807.0",
    "1e3",
    "1E+5",
    "0x10",
    "0b1",
    "1_000",
    "1 000",
    "12a",
    "a12",
    "٤٢",
    '"42"',
    "true",
    "null",
    "[1]",
  ])("%j is not a whole number", (valueJson) => {
    expect(ValueKinds.isWholeNumber(valueJson)).toBe(false)
  })
})

describe("ValueKinds.isFiniteNumber", () => {
  const LARGEST = "1.7976931348623157e308"
  const BEYOND_A_DOUBLE = `${"9".repeat(400)}.5`

  test.each([
    LARGEST,
    `-${LARGEST}`,
    "1.7976931348623158e308",
    `17976931348623157${"0".repeat(292)}`,
    `1${"0".repeat(308)}`,
    "5e-324",
    "-5e-324",
    "2.2250738585072014e-308",
    "1e-400",
    "0",
    "-0",
    "0.0",
    "0e0",
    "42",
    "-7",
    "4.5",
    "1e3",
    "1E+5",
    "2.5e-3",
    "-4.5E-3",
    "9223372036854775808",
    "0001.5",
    " 1.5 ",
    `\n${LARGEST}\t`,
  ])("%j is a number a double holds", (valueJson) => {
    expect(ValueKinds.isFiniteNumber(valueJson)).toBe(true)
    expect(["integer", "decimal"]).toContain(ValueKinds.ofJson(valueJson))
  })

  test.each([
    "1.8e308",
    "-1.8e308",
    "1.7976931348623159e308",
    `17976931348623159${"0".repeat(292)}`,
    `1${"0".repeat(309)}`,
    "1e400",
    "-1e400",
    "1E+400",
    BEYOND_A_DOUBLE,
    `-${BEYOND_A_DOUBLE}`,
    ` ${BEYOND_A_DOUBLE} `,
  ])("%j is a number beyond the range of a double", (valueJson) => {
    expect(ValueKinds.isFiniteNumber(valueJson)).toBe(false)
    expect(["integer", "decimal"]).toContain(ValueKinds.ofJson(valueJson))
  })

  test.each([
    "",
    " ",
    "-",
    "+1",
    "+1.5",
    "1.",
    ".5",
    "1e",
    "0x10",
    "0b1",
    "1_000",
    "1 000",
    "Infinity",
    "-Infinity",
    "NaN",
    "٤٢",
    '"1.5"',
    "true",
    "null",
    "[1.5]",
  ])("%j is not a number", (valueJson) => {
    expect(ValueKinds.isFiniteNumber(valueJson)).toBe(false)
  })
})
