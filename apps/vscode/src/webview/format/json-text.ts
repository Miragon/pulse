const TOKEN = /"(?:[^"\\]|\\.)*"|[{}[\],:]|[^\s{}[\],:"]+/g
const OPENING: ReadonlySet<string> = new Set(["{", "["])
const CLOSING: ReadonlySet<string> = new Set(["}", "]"])
const INDENT = "  "

export class JsonText {
  static pretty(text: string): string {
    return JsonText.isJson(text) ? JsonText.layoutOf(text.match(TOKEN) ?? []) : text
  }

  static compact(text: string): string {
    return JsonText.isJson(text) ? (text.match(TOKEN) ?? []).join("") : text.trim()
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
          if (CLOSING.has(tokens[index + 1] ?? "")) {
            return token
          }
          depth += 1
          return `${token}${line()}`
        }
        if (CLOSING.has(token)) {
          if (OPENING.has(tokens[index - 1] ?? "")) {
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
