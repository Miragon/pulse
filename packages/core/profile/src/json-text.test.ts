import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { jsonErrorPosition, objectMembers, rootStart } from "./json-text.js"

describe("jsonErrorPosition", () => {
  it.each([
    ["{}", undefined],
    [' [true, false, null, -1.5e3, "a\\\\u00e9\\\\n"] ', undefined],
    ['"\u007f\u0085"', undefined],
    [' { "a" : [ 1 , { } ] , "b" : "c" } ', undefined],
    ['"\\u00e9 \\uD83D\\uDE00 \\u002F"', undefined],
    ["[0.25, -1.5e+10, 2E-3, 10e10]", undefined],
    ['{"a": sk_live}', { line: 1, column: 7 }],
    ['{\n "a": 1,\n}', { line: 3, column: 1 }],
    ["[1,2", { line: 1, column: 5 }],
    ["", { line: 1, column: 1 }],
    ['{"a":1} x', { line: 1, column: 9 }],
    ['"\\u12"', { line: 1, column: 1 }],
    ['"\\x"', { line: 1, column: 1 }],
    ['"open', { line: 1, column: 1 }],
    ["[1,]", { line: 1, column: 4 }],
    ['{"a" 1}', { line: 1, column: 6 }],
    ["01", { line: 1, column: 2 }],
    ['{"a":"line\nbreak"}', { line: 1, column: 6 }],
  ])("finds the error in %j", (text, position) => {
    expect(jsonErrorPosition(text)).toEqual(position)
  })

  it("gives no position for nesting deeper than the call stack", () => {
    expect(jsonErrorPosition(`${"[".repeat(200_000)}x`)).toBeUndefined()
  })

  it("agrees with JSON.parse about validity", () => {
    const text = fc.oneof(
      fc.json(),
      fc.json().map((json) => json.slice(0, -1)),
      fc.string({
        unit: fc.constantFrom("{", "}", "[", "]", ",", ":", '"', "\\", "1", "a", " ", "\n", "true"),
      }),
    )
    fc.assert(
      fc.property(text, (candidate) => {
        let valid = true
        try {
          JSON.parse(candidate)
        } catch {
          valid = false
        }
        expect(jsonErrorPosition(candidate) === undefined).toBe(valid)
      }),
    )
  })
})

describe("objectMembers", () => {
  const keysOf = (text: string) => {
    const { first, repeated } = objectMembers(text, rootStart(text))
    return { keys: first.map(({ key }) => key), repeated }
  }

  it("lists the keys in the text's order, digits included, and the ones it repeats", () => {
    expect(
      keysOf(' { "b": 1, "10": [1, {"x": "}"}], "2": "a\\"b", "b": {}, "10": 2, "b": 3 }'),
    ).toEqual({ keys: ["b", "10", "2"], repeated: ["b", "10"] })
  })

  it("decodes escaped keys and reads an empty object", () => {
    expect(keysOf('{"a\\u002db": true, "\\"q\\"": null}')).toEqual({
      keys: ["a-b", '"q"'],
      repeated: [],
    })
    expect(keysOf("{ }")).toEqual({ keys: [], repeated: [] })
  })

  it("gives the span of each value, so a nested object reads alike", () => {
    const text = '{"p": {"auth": {"type": "basic", "type": "none"}}, "q": -1.5e3}'
    const [p, q] = objectMembers(text, 0).first
    expect(q && text.slice(q.start, q.end)).toBe("-1.5e3")
    const auth = p && objectMembers(text, p.start).first[0]
    expect(auth && objectMembers(text, auth.start).repeated).toEqual(["type"])
  })

  it("points a repeated key at its last value, the one JSON.parse keeps", () => {
    const text = '{\n "a": "",\n "b": 1,\n "a": {"x": 1}\n}'
    const { first, repeated } = objectMembers(text, rootStart(text))
    expect(first.map(({ key }) => key)).toEqual(["a", "b"])
    expect(repeated).toEqual(["a"])
    const [a] = first
    expect(a && text.slice(a.start, a.end)).toBe('{"x": 1}')
  })

  it("reads no members where no object opens", () => {
    const text = '{"a": "x", "b": ["c", {"d": 1}]}'
    for (const member of objectMembers(text, 0).first) {
      expect(objectMembers(text, member.start)).toEqual({ first: [], repeated: [] })
    }
  })

  it("agrees with JSON.parse on the keys of any object", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (value) => {
        const text = JSON.stringify(value, null, 1)
        const { first, repeated } = objectMembers(text, rootStart(text))
        expect(first.map(({ key }) => key).sort()).toEqual(Object.keys(value).sort())
        expect(repeated).toEqual([])
      }),
    )
  })
})
