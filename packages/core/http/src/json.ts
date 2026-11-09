/**
 * JSON without losing integers beyond 2^53. An engine's `Long` (an id, a variable such as
 * 9223372036854775807) is an integer literal in the JSON text, and `JSON.parse` rounds it to the
 * nearest double; the caller chooses what such an integer becomes instead.
 */

/**
 * What an integer literal beyond 2^53 becomes: `"number"` the rounded double (`JSON.parse`),
 * `"string"` its exact digits as a string, `"bigint"` a BigInt, `"raw"` a `JSON.rawJSON` value,
 * which `JSON.stringify` writes back digit for digit. Every other number stays a number.
 */
export type IntegerMode = "number" | "string" | "bigint" | "raw"

export const INTEGER_MODES: readonly IntegerMode[] = ["number", "string", "bigint", "raw"]

/** The parts of `JSON` that TypeScript's ES2023 lib does not describe (Node.js >= 21 has them). */
interface SourceJson {
  parse(
    text: string,
    reviver: (key: string, value: unknown, context: { readonly source?: string }) => unknown,
  ): unknown
  rawJSON(text: string): unknown
}

const SOURCE_JSON = JSON as unknown as SourceJson
const INTEGER_LITERAL = /^-?\d+$/

function exact(
  value: unknown,
  source: string | undefined,
  integers: Exclude<IntegerMode, "number">,
): unknown {
  if (typeof value !== "number" || Number.isSafeInteger(value)) return value
  if (source === undefined || !INTEGER_LITERAL.test(source)) return value
  if (integers === "string") return source
  return integers === "bigint" ? BigInt(source) : SOURCE_JSON.rawJSON(source)
}

/** `JSON.parse`, with integers beyond 2^53 as `integers` says. Throws like `JSON.parse`. */
export function parseJson(text: string, integers: IntegerMode = "number"): unknown {
  if (integers === "number") return JSON.parse(text) as unknown
  return SOURCE_JSON.parse(text, (_key, value, context) => exact(value, context.source, integers))
}

/** `JSON.stringify` that writes a BigInt as a plain JSON number, digit for digit. */
export function stringifyJson(value: unknown, indent?: number): string | undefined {
  return JSON.stringify(
    value,
    (_key, entry: unknown) =>
      typeof entry === "bigint" ? SOURCE_JSON.rawJSON(entry.toString()) : entry,
    indent,
  )
}
