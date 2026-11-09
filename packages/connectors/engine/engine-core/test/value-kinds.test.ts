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
