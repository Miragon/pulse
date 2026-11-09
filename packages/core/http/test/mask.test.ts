import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { clipText, MASK, maskJsonText, maskSecrets, secretForms } from "../src/index.js"

/** A secret as a credential has one: at least four characters, no whitespace at its ends. */
const secret = fc
  .string({ unit: "grapheme", minLength: 4, maxLength: 24 })
  .map((value) => value.trim())
  .filter((value) => value.length >= 4 && !value.includes(MASK.slice(0, 1)))

describe("secretForms", () => {
  it("is every value trimmed, percent-encoded, JSON-escaped, as a URL path and a form write it, longest first", () => {
    expect(secretForms(['  pa"ss wo/rd\n', undefined])).toEqual([
      "pa%22ss%20wo%2Frd",
      "pa%22ss%20wo/rd",
      "pa%22ss+wo%2Frd",
      'pa\\"ss wo/rd',
      'pa"ss wo/rd',
    ])
  })

  it("writes a value as the URL parser does into a path, and as a form does", () => {
    expect(secretForms(["Qz a@b!pw?#"])).toEqual([
      "Qz%20a%40b!pw%3F%23",
      "Qz+a%40b%21pw%3F%23",
      "Qz%20a@b!pw%3F%23",
      "Qz a@b!pw?#",
    ])
  })

  it("skips values under four characters and empty ones, whatever their encodings", () => {
    expect(secretForms(["abc", "   ", "", undefined, " abc ", "a b", "é"])).toEqual([])
  })

  it("leaves out a form the URL parser shortened below four characters", () => {
    expect(secretForms(["x/../yz"])).toEqual(["x%2F..%2Fyz", "x/../yz"])
    expect(secretForms(["abcd"])).toEqual(["abcd"])
  })

  it("encodes a value with its whitespace collapsed and as it is, each space of a run", () => {
    expect(secretForms(["a  b\tc d"])).toEqual([
      "a%20%20b%09c%20d",
      "a%20b%20c%20d",
      "a%20%20bc%20d",
      "a++b%09c+d",
      "a  b\\tc d",
      "a  b\tc d",
      "a b c d",
      "a+b+c+d",
    ])
  })
})

describe("maskSecrets", () => {
  it("masks every occurrence, keeping the text's own whitespace", () => {
    const forms = secretForms(["demo-secret"])
    expect(maskSecrets("pw demo-secret\n\tand demo-secret.", forms)).toBe("pw ***\n\tand ***.")
  })

  it("finds a secret with whitespace however the text reflows it", () => {
    const forms = secretForms(["two words here"])
    expect(maskSecrets("x two\n   words\there y", forms)).toBe("x *** y")
  })

  it("masks the longer form whole before a shorter one inside it", () => {
    const forms = secretForms(["abcd", "abcdefgh"])
    expect(maskSecrets("abcdefgh abcd", forms)).toBe("*** ***")
  })

  it("treats a secret's regex characters literally", () => {
    const forms = secretForms(["a.b*c+(d)[e]$"])
    expect(maskSecrets("a.b*c+(d)[e]$ axbbc", forms)).toBe("*** axbbc")
  })

  it("leaves a text without a secret alone", () => {
    expect(maskSecrets("nothing here", secretForms(["secret"]))).toBe("nothing here")
    expect(maskSecrets("anything", [])).toBe("anything")
  })

  it("never shows a secret however the text around it reads", () => {
    fc.assert(
      fc.property(secret, fc.string(), fc.string(), (value, before, after) => {
        const forms = secretForms([value])
        const text = `${before}${value}${after}${encodeURIComponent(value)}${JSON.stringify(value)}`
        expect(maskSecrets(text, forms)).not.toContain(value)
      }),
    )
  })
})

describe("maskJsonText", () => {
  it("masks inside string literals, so the text stays JSON", () => {
    const forms = secretForms(["tok-demo-123"])
    const text = '{"message":"sent Bearer tok-demo-123","code":1}'
    const masked = maskJsonText(text, forms)
    expect(JSON.parse(masked)).toEqual({ message: "sent Bearer ***", code: 1 })
  })

  it("finds a secret the JSON writes with escapes", () => {
    const forms = secretForms(["pass\\word"])
    const text = JSON.stringify({ message: "pw: pass\\word", other: "x\u0001y" })
    expect(JSON.parse(maskJsonText(text, forms))).toEqual({ message: "pw: ***", other: "x\u0001y" })
    const escaped = '{"m":"t\\u006fk-demo-123"}'
    expect(JSON.parse(maskJsonText(escaped, secretForms(["tok-demo-123"])))).toEqual({ m: "***" })
  })

  it("keeps a literal without a secret byte for byte", () => {
    const text = '{"a":"\\/x\\u00e9","n":12345678}'
    expect(maskJsonText(text, secretForms(["secret"]))).toBe(text)
    expect(maskJsonText(text, [])).toBe(text)
  })

  it("masks the whole text when a secret sits outside the literals", () => {
    const masked = maskJsonText('{"code":12345678,"m":"12345678"}', secretForms(["12345678"]))
    expect(masked).toBe('{"code":***,"m":"***"}')
  })

  it("masks text that is no JSON, an unterminated literal included", () => {
    const forms = secretForms(["demo-secret"])
    expect(maskJsonText('{"m":"demo-secret', forms)).toBe('{"m":"***')
    expect(maskJsonText('{"m":"x"} demo-secret', forms)).toBe('{"m":"x"} ***')
    expect(maskJsonText('"\\x demo-secret"', forms)).toBe('"\\x ***"')
  })

  it("never shows a secret and keeps valid JSON valid", () => {
    fc.assert(
      fc.property(fc.json(), secret, fc.string(), (base, value, around) => {
        const document = { base: JSON.parse(base) as unknown, said: `${around}${value}${around}` }
        const masked = maskJsonText(JSON.stringify(document), secretForms([value]))
        expect(masked).not.toContain(value)
        expect(masked).not.toContain(JSON.stringify(value).slice(1, -1))
      }),
    )
  })
})

describe("clipText", () => {
  it("collapses whitespace and cuts after the limit", () => {
    expect(clipText("  a\n\tb  ")).toBe("a b")
    expect(clipText("x".repeat(501))).toBe(`${"x".repeat(500)}…`)
    expect(clipText("x".repeat(500))).toBe("x".repeat(500))
    expect(clipText("abcdef", 3)).toBe("abc…")
  })
})
