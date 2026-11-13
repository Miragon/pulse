/**
 * Reading an answer: its text in the charset it declares, and what an error body states.
 */
import type { Problem } from "./failure.js"
import { parseJson } from "./json.js"
import type { HttpAnswer } from "./types.js"

type Body = Pick<HttpAnswer, "body" | "contentType">

/** The media type without parameters, in lower case: `Text/XML; charset=UTF-8` is `text/xml`. */
export function mediaTypeOf(contentType: string): string {
  return contentType.replace(/;.*/s, "").trim().toLowerCase()
}

const CHARSET = /;\s*charset\s*=\s*"?([^";\s]+)/i

/** The body as text in the charset of its Content-Type; UTF-8 when it names none or an unknown one. */
export function decodeText(answer: Body): string {
  const label = CHARSET.exec(answer.contentType)?.[1]
  try {
    return new TextDecoder(label).decode(answer.body)
  } catch {
    return new TextDecoder().decode(answer.body)
  }
}

/** An exception type worth showing: a (qualified) class name, nothing longer. */
const EXCEPTION_TYPE = /^[\w$.]{1,120}$/

/** Where an error body puts its message, in the order read. */
const MESSAGE_KEYS = ["message", "detail", "error_description", "error", "title"] as const

function stringAt(record: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function jsonProblem(answer: Body): Problem {
  let parsed: unknown
  try {
    parsed = parseJson(decodeText(answer))
  } catch {
    return {}
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
  const record = parsed as Readonly<Record<string, unknown>>
  const type = stringAt(record, "type")
  const message = MESSAGE_KEYS.map((key) => stringAt(record, key)).find(Boolean)
  const code = record.code
  return {
    ...(type !== undefined && EXCEPTION_TYPE.test(type) ? { type } : {}),
    ...(message === undefined ? {} : { message }),
    ...(typeof code === "number" ? { code } : {}),
  }
}

/**
 * What an error body states: from JSON its exception type and message, from plain text the
 * text; an HTML page (a servlet container's, a proxy's) states nothing its status line does not.
 */
export function problemOf(answer: Body): Problem {
  const type = mediaTypeOf(answer.contentType)
  if (type.includes("json")) return jsonProblem(answer)
  if (!type.startsWith("text/") || type === "text/html") return {}
  const text = decodeText(answer).trim()
  return text === "" ? {} : { message: text }
}
