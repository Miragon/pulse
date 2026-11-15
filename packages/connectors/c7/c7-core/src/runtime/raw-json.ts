/**
 * A typed view of `JSON.rawJSON` and `JSON.isRawJSON`, which every runtime c7-core supports
 * (Node.js 22, the browsers the editor hosts run in) but the ES2023 lib it compiles against does
 * not declare. A raw JSON value is JSON text the serializer writes as it is: an integer beyond
 * 2^53 that a lossless parse kept digit for digit. Pure.
 */

interface RawJsonSupport {
  rawJSON(text: string): unknown
  isRawJSON(value: unknown): boolean
}

const support = JSON as unknown as RawJsonSupport

/** The raw JSON value of `text` (a JSON primitive), which `JSON.stringify` writes unchanged. */
export function rawJson(text: string): unknown {
  return support.rawJSON(text)
}

/** True for a raw JSON value: JSON text of the answer, never an object of it. */
export function isRawJson(value: unknown): boolean {
  return support.isRawJSON(value)
}
