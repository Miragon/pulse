import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { INTEGER_MODES, parseJson, stringifyJson } from "../src/index.js"

const BIG = "9223372036854775807"
const TEXT = `{"type":"Long","value":${BIG},"ratio":0.5,"small":42,"list":[-${BIG},1.5]}`

describe("parseJson keeps integers beyond 2^53 as the caller chooses", () => {
  it("as exact-digit strings", () => {
    expect(parseJson(TEXT, "string")).toEqual({
      type: "Long",
      value: BIG,
      ratio: 0.5,
      small: 42,
      list: [`-${BIG}`, 1.5],
    })
  })

  it("as numbers JSON.parse rounds, the default", () => {
    const parsed = parseJson(TEXT) as { value: number }
    expect(parsed).toEqual(JSON.parse(TEXT))
    expect(parsed.value).toBe(9223372036854776000)
    expect(parseJson(TEXT, "number")).toEqual(JSON.parse(TEXT))
  })

  it("as BigInts, which stringifyJson writes back digit for digit", () => {
    const parsed = parseJson(TEXT, "bigint") as { value: bigint; list: unknown[] }
    expect(parsed.value).toBe(9223372036854775807n)
    expect(parsed.list[0]).toBe(-9223372036854775807n)
    expect(stringifyJson(parsed)).toBe(TEXT)
  })

  it("as raw JSON values, which JSON.stringify writes back digit for digit", () => {
    expect(JSON.stringify(parseJson(TEXT, "raw"))).toBe(TEXT)
    expect(stringifyJson(parseJson(TEXT, "raw"))).toBe(TEXT)
  })

  it("leaves safe integers, fractions and exponents numbers in every mode", () => {
    for (const mode of INTEGER_MODES) {
      expect(parseJson("[9007199254740991,1.5,2e3,-0]", mode)).toEqual([
        9007199254740991, 1.5, 2000, -0,
      ])
    }
  })

  it("keeps every integer literal beyond 2^53 exact, wherever it sits", () => {
    const beyond = fc
      .bigInt({ min: 2n ** 53n, max: 2n ** 70n })
      .chain((n) => fc.constantFrom(n, -n))
    fc.assert(
      fc.property(beyond, fc.string(), (n, key) => {
        const text = `{${JSON.stringify(key)}:[{"n":${n.toString()}}]}`
        const value = (parsed: unknown) => (parsed as Record<string, [{ n: unknown }]>)[key]?.[0]?.n
        expect(value(parseJson(text, "string"))).toBe(n.toString())
        expect(value(parseJson(text, "bigint"))).toBe(n)
        expect(stringifyJson(parseJson(text, "raw"))).toBe(text)
        expect(value(parseJson(text, "number"))).toBe(Number(n))
      }),
    )
  })

  it("throws like JSON.parse on text that is no JSON", () => {
    for (const mode of INTEGER_MODES) expect(() => parseJson("{", mode)).toThrow(SyntaxError)
  })

  it("stringifies undefined as undefined and indents on request", () => {
    expect(stringifyJson(undefined)).toBeUndefined()
    expect(stringifyJson({ a: 1n }, 2)).toBe('{\n  "a": 1\n}')
  })
})
