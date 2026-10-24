const CAUSED_BY = "Caused by: "
const MAX_LENGTH = 300
const QUALIFIED_CLASS = /^(?:[a-z_$][\w$]*\.)+([A-Z][\w$]*)(?=:|\s|$)/

export class RootCause {
  static of(text: string): string | undefined {
    const lines = RootCause.linesOf(text)
    const caused = lines.filter((line) => line.startsWith(CAUSED_BY)).at(-1)
    const line = caused?.slice(CAUSED_BY.length) ?? lines.find((candidate) => candidate !== "")
    if (line === undefined) {
      return undefined
    }
    const simple = line.replace(QUALIFIED_CLASS, "$1").replace(/\s+/g, " ").trim()
    return simple.length > MAX_LENGTH ? `${simple.slice(0, MAX_LENGTH - 1)}…` : simple
  }

  static lineIndex(text: string): number | undefined {
    const index = RootCause.linesOf(text).findLastIndex((line) => line.startsWith(CAUSED_BY))
    return index === -1 ? undefined : index
  }

  private static linesOf(text: string): string[] {
    return text.split(/\r\n|[\n\r]/).map((line) => line.trim())
  }
}
