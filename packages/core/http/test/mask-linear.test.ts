/**
 * Masking a JSON answer in one pass (#691, F34): the same result as the masking up to 0.34
 * (mask-reference.ts) over random texts and forms; only a literal or a number a form starts in,
 * or a literal with an escape, looked at, its value searched once for all forms; and where the
 * next form starts searched at most once per piece. What that costs on large answers,
 * mask-cpu.test.ts measures in a process of its own, since these spies slow every pattern after
 * them.
 */
import fc from "fast-check"
import { describe, expect, it, vi } from "vitest"
import { maskJsonText, maskSecrets, secretForms } from "../src/index.js"
import { referenceMaskJsonText, referenceMaskSecrets } from "./mask-reference.js"

/** What JSON is made of and broken by, and what a secret is written with in it. */
const unit = fc.constantFrom(
  ...['"', "\\", "u", "0", "6", "1", "5", "e", "E", "-", "+", ".", ",", ":", "[", "{", "}"],
  ...[" ", "\n", "\t", "a", "*", "%", "/", "\u0001", "é"],
)
const word = fc.string({ unit, maxLength: 6 })

/** `value` with each of its characters written as a `\u` escape, as a JSON literal may hold it. */
const unicodeEscaped = (value: string): string =>
  value.replace(/[\s\S]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`)

/**
 * Secret values and a text that writes them among random pieces: as they are, as a JSON literal
 * escapes them and in `\u` escapes; masked with their forms or with the values themselves, which
 * may be empty, a quote, a backslash or whitespace, since `maskJsonText` takes any forms.
 */
const sample = fc.array(word, { minLength: 1, maxLength: 3 }).chain((values) => {
  const written = values.flatMap((value) => [
    value,
    JSON.stringify(value),
    `"${unicodeEscaped(value)}"`,
  ])
  return fc.record({
    forms: fc.oneof(fc.constant(secretForms(values)), fc.constant(values)),
    text: fc
      .array(fc.oneof(word, fc.constantFrom(...written)), { maxLength: 12 })
      .map((parts) => parts.join("")),
  })
})

/**
 * The limit of the properties: the three take 1.5 s alone with coverage and took 7.6 s for the
 * first while `pnpm test` ran every package's suite at once on a runner at its limit.
 */
const PROPERTIES = { timeout: 30_000 }

describe("the same result as the masking up to 0.34", PROPERTIES, () => {
  it("of maskJsonText, on any text with any forms", () => {
    fc.assert(
      fc.property(sample, ({ text, forms }) => {
        expect(maskJsonText(text, forms)).toBe(referenceMaskJsonText(text, forms))
      }),
      { numRuns: 3000 },
    )
  })

  it("of maskJsonText, on JSON that holds a secret in a key, a string and its numbers", () => {
    const secret = fc.string({ unit: "grapheme", minLength: 4, maxLength: 12 })
    const digits = fc.stringMatching(/^[1-9]\d{3,6}$/)
    fc.assert(
      fc.property(fc.json(), secret, digits, (base, value, code) => {
        const document = {
          base: JSON.parse(base) as unknown,
          [value]: `said ${value}`,
          code: Number(code),
          n: [Number(`1${code}`), 2.5, -Number(code)],
        }
        const text = JSON.stringify(document)
        const forms = secretForms([value, code])
        expect(maskJsonText(text, forms)).toBe(referenceMaskJsonText(text, forms))
      }),
      { numRuns: 300 },
    )
  })

  it("of maskSecrets, on any text with any forms", () => {
    fc.assert(
      fc.property(sample, ({ text, forms }) => {
        expect(maskSecrets(text, forms)).toBe(referenceMaskSecrets(text, forms))
      }),
      { numRuns: 1000 },
    )
  })
})

describe("maskJsonText looks only where a secret may be", () => {
  /** A password that starts with a quote, so a form of it starts on a literal's quote. */
  const forms = secretForms(['"Qz1x', "Qz2y", "10000"])

  it("parses only a literal a form starts in or a backslash stands in, and masks it only if one is in it", () => {
    // "a" is followed by Qz1x, so the form "Qz1x starts on its closing quote, not in it; \q is
    // no JSON escape, so that literal is searched as it is written.
    const text = '["plain","a"Qz1x,"b","Qz1x in","in Qz2y","t\\u0061b","\\q Qz2y"]'
    const parse = vi.spyOn(JSON, "parse")
    const test = vi.spyOn(RegExp.prototype, "test")
    const masked = maskJsonText(text, forms)
    const parsed = parse.mock.calls.map(([literal]) => literal)
    const searched = test.mock.calls.map(([value]) => value)
    parse.mockRestore()
    test.mockRestore()
    expect(parsed).toEqual(['"Qz1x in"', '"in Qz2y"', '"t\\u0061b"', '"\\q Qz2y"'])
    // Each value once for all forms; only one a form is in is masked form by form.
    expect(searched).toEqual(["Qz1x in", "in Qz2y", "tab", '"\\q Qz2y"'])
    expect(masked).toBe('["plain","a***,"b",*** in","in ***","t\\u0061b","\\q ***"]')
    expect(masked).toBe(referenceMaskJsonText(text, forms))
  })

  it("reads the numbers only of a stretch between literals a form starts in", () => {
    // 10000 right after "b" starts the stretch; "Qz1x starts on the quote after 4, not before it,
    // so the literal it starts on is looked at, and its value searched once for all forms.
    const text = '[1,2,"a",3,10000,"b"10000,"c",4,"Qz1x",5,6]'
    const test = vi.spyOn(RegExp.prototype, "test")
    const masked = maskJsonText(text, forms)
    const tested = test.mock.calls.map(([number]) => number)
    test.mockRestore()
    expect(tested).toEqual(["3", "10000", "10000", "Qz1x"])
    expect(masked).toBe('[1,2,"a",3,"***","b""***","c",4,***",5,6]')
    expect(masked).toBe(referenceMaskJsonText(text, forms))
  })

  it("searches where the next form starts at most once per piece, from the piece on", () => {
    // 0000 overlaps itself, so a form starts at five places of the run; Qz2y right after "e"
    // starts the stretch that follows it, where the start found before still holds.
    const text = '["a","b00000000c","d",1,"e"Qz2y,"f"]'
    const twoForms = secretForms(["0000", "Qz2y"])
    // Where each search with the one pattern of all forms (global, no other flag) begins.
    const searches: number[] = []
    const alternation = twoForms.join("|")
    const exec = Object.getOwnPropertyDescriptor(RegExp.prototype, "exec")?.value as RegExp["exec"]
    function recorded(this: RegExp, input: string): RegExpExecArray | null {
      if (this.flags === "g" && this.source === alternation) searches.push(this.lastIndex)
      return exec.call(this, input)
    }
    const spy = vi.spyOn(RegExp.prototype, "exec").mockImplementation(recorded)
    const masked = maskJsonText(text, twoForms)
    spy.mockRestore()
    expect(twoForms).toEqual(["0000", "Qz2y"])
    expect(searches).toEqual([0, text.indexOf(',"d"'), text.indexOf('"f"')])
    expect(masked).toBe('["a","b******c","d",1,"e"***,"f"]')
    expect(masked).toBe(referenceMaskJsonText(text, twoForms))
  })
})
