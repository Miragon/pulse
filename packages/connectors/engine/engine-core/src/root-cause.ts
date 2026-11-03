/**
 * The root cause of a failure: one line out of a Java stacktrace or an external
 * task's error details. Pure.
 */

const CAUSED_BY = "Caused by: "
const MAX_LENGTH = 300

/** A leading qualified Java class name: `org.camunda.bpm.engine.ProcessEngineException`. */
const QUALIFIED_CLASS = /^(?:[a-z_$][\w$]*\.)+([A-Z][\w$]*)(?=:|\s|$)/

/**
 * The last `Caused by: ` line (prefix removed), else the first non-blank line; a leading
 * qualified class name shortened to its simple name; whitespace collapsed; at most 300
 * characters. Undefined for a blank text.
 */
export function rootCause(text: string): string | undefined {
  const lines = linesOf(text)
  const caused = lines.filter((line) => line.startsWith(CAUSED_BY)).at(-1)
  const line = caused?.slice(CAUSED_BY.length) ?? lines.find((candidate) => candidate !== "")
  if (line === undefined) return undefined
  const simple = line.replace(QUALIFIED_CLASS, "$1").replace(/\s+/g, " ").trim()
  return simple.length > MAX_LENGTH ? `${simple.slice(0, MAX_LENGTH - 1)}…` : simple
}

/**
 * The index of the last `Caused by: ` line (the line {@link rootCause} takes its cause from), in
 * the lines of `text` split at CRLF, LF and CR; undefined without one. A viewer opens the text
 * there.
 */
export function rootCauseLine(text: string): number | undefined {
  const index = linesOf(text).findLastIndex((line) => line.startsWith(CAUSED_BY))
  return index === -1 ? undefined : index
}

function linesOf(text: string): string[] {
  return text.split(/\r\n|[\n\r]/).map((line) => line.trim())
}
