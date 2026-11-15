import { describe, expect, it } from "vitest"
import { isRawJson, rawJson } from "./raw-json.js"

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
