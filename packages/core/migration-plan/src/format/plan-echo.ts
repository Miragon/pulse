export class PlanEcho {
  static readonly MAX_CHARACTERS = 40
  private static readonly CUT = "…"

  static key(key: string): string {
    const head = PlanEcho.head(key)
    return head === key ? key : `${head}${PlanEcho.CUT}`
  }

  static value(value: unknown): string {
    if (typeof value === "string") {
      const head = PlanEcho.head(value)
      return `${JSON.stringify(head)}${head === value ? "" : PlanEcho.CUT}`
    }
    if (Array.isArray(value)) {
      return "a list"
    }
    return typeof value === "object" && value !== null ? "an object" : String(value)
  }

  private static head(text: string): string {
    let head = ""
    let count = 0
    for (const character of text) {
      if (count === PlanEcho.MAX_CHARACTERS) {
        return head
      }
      head += character
      count += 1
    }
    return text
  }
}
