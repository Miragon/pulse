const WHITESPACE: ReadonlySet<string | undefined> = new Set([" ", "\t", "\n", "\r"])
const PUNCTUATION: ReadonlySet<string | undefined> = new Set(["{", "}", "[", "]", ",", ":"])
const BOUNDARY: ReadonlySet<string | undefined> = new Set([...WHITESPACE, ...PUNCTUATION, '"'])
const OPENING: ReadonlySet<string | undefined> = new Set(["{", "["])
const CLOSING: ReadonlySet<string | undefined> = new Set(["}", "]"])
const INDENT = "  "

/**
 * A variable's value as JSON text, laid out without parsing its numbers, so an integer beyond 2^53
 * keeps every digit: `pretty` on lines with two spaces of indent (what a value shows opened and an
 * editor starts from), `compact` on one line (what an editor writes). A text that is no JSON stays
 * as it is.
 */
export class JsonText {
  static pretty(text: string): string {
    return JsonText.isJson(text) ? JsonText.layoutOf(JsonText.tokensOf(text)) : text
  }

  static compact(text: string): string {
    return JsonText.isJson(text) ? JsonText.tokensOf(text).join("") : text.trim()
  }

  /** The tokens of a JSON text in one pass, whitespace outside strings dropped; no pattern backtracks. */
  private static tokensOf(text: string): string[] {
    const tokens: string[] = []
    let index = 0
    while (index < text.length) {
      const end = JsonText.tokenEnd(text, index)
      if (!WHITESPACE.has(text[index])) {
        tokens.push(text.slice(index, end))
      }
      index = end
    }
    return tokens
  }

  private static tokenEnd(text: string, start: number): number {
    const first = text[start]
    if (first === '"') {
      return JsonText.stringEnd(text, start + 1)
    }
    if (WHITESPACE.has(first) || PUNCTUATION.has(first)) {
      return start + 1
    }
    let end = start + 1
    while (end < text.length && !BOUNDARY.has(text[end])) {
      end += 1
    }
    return end
  }

  /** Past the quote that closes the string whose content starts at `start`, an escape skipped whole. */
  private static stringEnd(text: string, start: number): number {
    let end = start
    while (end < text.length && text[end] !== '"') {
      end += text[end] === "\\" ? 2 : 1
    }
    return end + 1
  }

  private static isJson(text: string): boolean {
    try {
      JSON.parse(text)
      return true
    } catch {
      return false
    }
  }

  private static layoutOf(tokens: readonly string[]): string {
    let depth = 0
    const line = (): string => `\n${INDENT.repeat(depth)}`
    return tokens
      .map((token, index) => {
        if (OPENING.has(token)) {
          if (CLOSING.has(tokens[index + 1])) {
            return token
          }
          depth += 1
          return `${token}${line()}`
        }
        if (CLOSING.has(token)) {
          if (OPENING.has(tokens[index - 1])) {
            return token
          }
          depth -= 1
          return `${line()}${token}`
        }
        return token === "," ? `,${line()}` : token === ":" ? ": " : token
      })
      .join("")
  }
}
