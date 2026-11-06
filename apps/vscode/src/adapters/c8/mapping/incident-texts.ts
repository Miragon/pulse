import type { IncidentDetails } from "../../../contract/index.js"

const CAUSED_BY = "Caused by: "
const MAX_LENGTH = 300
const LINE_BREAK = /\r\n|[\n\r]/
const QUALIFIED_CLASS = /^(?:[a-z_$][\w$]*\.)+([A-Z][\w$]*)(?=:|\s|$)/

export class IncidentTexts {
  static details(text: string): IncidentDetails {
    const lines = text.split(LINE_BREAK).map((line) => line.trim())
    const cause = lines.findLastIndex((line) => line.startsWith(CAUSED_BY))
    const line = cause === -1 ? lines.findIndex((candidate) => candidate !== "") : cause
    const rootCause = IncidentTexts.causeOf(lines[line], cause !== -1)
    return {
      kind: "errorMessage",
      text,
      truncated: false,
      ...(rootCause === undefined ? {} : { rootCause, rootCauseLine: line }),
    }
  }

  private static causeOf(line: string | undefined, caused: boolean): string | undefined {
    if (line === undefined) {
      return undefined
    }
    const text = caused ? line.slice(CAUSED_BY.length) : line
    const simple = text.replace(QUALIFIED_CLASS, "$1").replace(/\s+/g, " ").trim()
    return simple.length > MAX_LENGTH ? `${simple.slice(0, MAX_LENGTH - 1)}…` : simple
  }
}
