import { describe, expect, it } from "vitest"
import { isRawJson, parseExact, rawJson } from "./raw-json.js"

const BEYOND_2_53 = "12345678901234567890"

describe("rawJson", () => {
  it("is written as its text, digit for digit", () => {
    expect(JSON.stringify({ count: rawJson(BEYOND_2_53) })).toBe(`{"count":${BEYOND_2_53}}`)
  })
})

describe("isRawJson", () => {
  it("is true for a raw JSON value only", () => {
    expect(isRawJson(rawJson(BEYOND_2_53))).toBe(true)
    expect(isRawJson(Number(BEYOND_2_53))).toBe(false)
    expect(isRawJson(BEYOND_2_53)).toBe(false)
    expect(isRawJson({ rawJSON: BEYOND_2_53 })).toBe(false)
    expect(isRawJson(null)).toBe(false)
  })
})

describe("parseExact", () => {
  it.each([
    ["a number", "42", 42],
    ["a text", '"42"', "42"],
    ["a boolean", "true", true],
    ["null", "null", null],
    ["the largest safe integer", "9007199254740991", 9007199254740991],
    ["an object", '{"city":"Munich"}', { city: "Munich" }],
    ["an array", '[1, "two"]', [1, "two"]],
  ])("reads %s as JSON.parse does", (_name, text, value) => {
    expect(parseExact(text)).toStrictEqual(value)
  })

  it.each([
    ["9007199254740993", "9007199254740993"],
    [" -9007199254740993\n", "-9007199254740993"],
    ["1.7976931348623157e308", "1.7976931348623157e308"],
    ["9007199254740993.0", "9007199254740993.0"],
  ])("keeps the integer beyond 2^53 of %j digit for digit", (text, written) => {
    const value = parseExact(text)
    expect(isRawJson(value)).toBe(true)
    expect(JSON.stringify({ value })).toBe(`{"value":${written}}`)
  })

  it.each([
    ["an object", '{"a": {"b": 9007199254740993}, "c": 1}', '{"a":{"b":9007199254740993},"c":1}'],
    ["an array", "[9007199254740993, 1.50]", "[9007199254740993,1.5]"],
  ])("keeps an integer beyond 2^53 nested in %s digit for digit", (_name, text, written) => {
    expect(JSON.stringify(parseExact(text))).toBe(written)
  })

  it.each([
    ["1.50", "1.5"],
    ["1e3", "1000"],
    ["-0", "0"],
    ["1e400", "null"],
  ])("writes %s as the parsed number", (text, written) => {
    expect(JSON.stringify({ value: parseExact(text) })).toBe(`{"value":${written}}`)
  })

  it("fails a text that is no JSON", () => {
    expect(() => parseExact("forty-two")).toThrow(SyntaxError)
  })
})
