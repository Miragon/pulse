import { describe, expect, it } from "vitest"
import { JsonText } from "./json-text.js"

describe("a variable's value as JSON text", () => {
  it("lays out JSON on lines, keeps every digit and leaves empty objects and lists on their line", () => {
    expect(JsonText.pretty('{"a":[1,{"b":"x,[y]"}],"c":{},"big":9007199254740993}')).toBe(
      '{\n  "a": [\n    1,\n    {\n      "b": "x,[y]"\n    }\n  ],\n  "c": {},\n  "big": 9007199254740993\n}',
    )
  })

  it("keeps a string whole: its escapes, an escaped backslash before its quote, its spaces and punctuation", () => {
    const text = '{ "q" : "say \\"hi\\", { x : [1] }", "path": "C:\\\\", "n": -1.5e3, "ok": true }'
    expect(JsonText.compact(text)).toBe(
      '{"q":"say \\"hi\\", { x : [1] }","path":"C:\\\\","n":-1.5e3,"ok":true}',
    )
    expect(JsonText.pretty('["\\\\\\"",null]')).toBe('[\n  "\\\\\\"",\n  null\n]')
  })

  it("reads a long run of escaped quotes in one pass", () => {
    const text = JSON.stringify({ quotes: '"'.repeat(100_000) })
    expect(JsonText.compact(text)).toBe(text)
  })

  it("writes JSON on one line and leaves a text that is no JSON as it is", () => {
    expect(JsonText.compact('{\n  "big": 9007199254740993\n}')).toBe('{"big":9007199254740993}')
    expect(JsonText.pretty("not json")).toBe("not json")
    expect(JsonText.compact(" not json ")).toBe("not json")
  })
})
