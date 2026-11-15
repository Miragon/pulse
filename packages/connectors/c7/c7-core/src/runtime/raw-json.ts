/**
 * A typed view of `JSON.rawJSON`, `JSON.isRawJSON` and the source text `JSON.parse` hands its
 * reviver, which every runtime c7-core supports (Node.js 22, the browsers the editor hosts run in)
 * but the ES2023 lib it compiles against does not declare. A raw JSON value is JSON text the
 * serializer writes as it is: an integer beyond 2^53 that a lossless parse kept digit for digit.
 * Pure.
 */

/** What a reviver learns of the value it gets: a primitive's text as written, none for the rest. */
interface ReviverContext {
  readonly source?: string
}

interface RawJsonSupport {
  parse(
    text: string,
    reviver: (key: string, value: unknown, context: ReviverContext) => unknown,
  ): unknown
  rawJSON(text: string): unknown
  isRawJSON(value: unknown): boolean
}

const support = JSON as unknown as RawJsonSupport

function isUnsafeInteger(value: unknown): boolean {
  return Number.isInteger(value) && !Number.isSafeInteger(value)
}

/** The raw JSON value of `text` (a JSON primitive), which `JSON.stringify` writes unchanged. */
export function rawJson(text: string): unknown {
  return support.rawJSON(text)
}

/** True for a raw JSON value: JSON text of the answer, never an object of it. */
export function isRawJson(value: unknown): boolean {
  return support.isRawJSON(value)
}

/**
 * `JSON.parse` of `text`, every integer beyond 2^53 in it, at any depth, kept as raw JSON of its
 * text as written, so `JSON.stringify` writes it back digit for digit. Throws like `JSON.parse`.
 */
export function parseExact(text: string): unknown {
  return support.parse(text, (_key, value, context) =>
    isUnsafeInteger(value) && context.source !== undefined ? rawJson(context.source) : value,
  )
}
