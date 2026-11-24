/**
 * Checked reads of an engine answer: a JSON object of the answer, whose values are read as the
 * shape the engine documents. A value of another shape is an answer the reader cannot use, so
 * it fails as `RuntimeError("unexpectedResponse")` with words that name what was wrong (`id is
 * missing`, `incidents is not a list`), never as a value read wrongly. A raw JSON value (an
 * integer beyond 2^53 kept digit for digit) is a value, never an object. Pure.
 */

import { RuntimeError } from "@miragon/pulse-engine-core"
import { isRawJson } from "./raw-json.js"

type JsonRecord = Readonly<Record<string, unknown>>

function unexpected(message: string): RuntimeError {
  return new RuntimeError("unexpectedResponse", message)
}

function isObject(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !isRawJson(value)
}

function isAbsent(value: unknown): value is undefined | null {
  return value === undefined || value === null
}

function listItems(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw unexpected(`${what} is not a list`)
  }
  return value
}

/** A JSON object of an engine answer, read with checks. */
export class JsonView {
  private constructor(private readonly record: JsonRecord) {}

  /** The object `value`, which the answer names `what`; anything else fails. */
  static of(value: unknown, what: string): JsonView {
    const view = JsonView.ifObject(value)
    if (view === undefined) {
      throw unexpected(`${what} is not an object`)
    }
    return view
  }

  /** The object `value`, or undefined when it is none (a typed variable value, say). */
  static ifObject(value: unknown): JsonView | undefined {
    return isObject(value) ? new JsonView(value) : undefined
  }

  /** The objects of the list `value`, which the answer names `what`; anything else fails. */
  static listOf(value: unknown, what: string): JsonView[] {
    return listItems(value, what).map((item, index) => JsonView.of(item, `${what}[${index}]`))
  }

  /** The value at `key` as it is, unchecked. */
  value(key: string): unknown {
    return this.record[key]
  }

  /** The object at `key`, which the answer names `what`. */
  object(key: string, what: string): JsonView {
    return JsonView.of(this.record[key], what)
  }

  /** The string at `key`, undefined when it is absent or null. */
  optionalString(key: string): string | undefined {
    const value = this.record[key]
    if (isAbsent(value)) {
      return undefined
    }
    if (typeof value !== "string") {
      throw unexpected(`${key} is not a string`)
    }
    return value
  }

  /** The string at `key`, which the answer must hold. */
  requiredString(key: string): string {
    const value = this.optionalString(key)
    if (value === undefined) {
      throw unexpected(`${key} is missing`)
    }
    return value
  }

  /** The number at `key`, undefined when it is absent or null. */
  optionalNumber(key: string): number | undefined {
    const value = this.record[key]
    if (isAbsent(value)) {
      return undefined
    }
    if (typeof value !== "number") {
      throw unexpected(`${key} is not a number`)
    }
    return value
  }

  /** The number at `key`, which the answer must hold. */
  requiredNumber(key: string): number {
    const value = this.optionalNumber(key)
    if (value === undefined) {
      throw unexpected(`${key} is missing`)
    }
    return value
  }

  /** The objects of the list at `key`, none when it is absent or null. */
  optionalList(key: string): JsonView[] {
    const value = this.record[key]
    return isAbsent(value) ? [] : JsonView.listOf(value, key)
  }

  /** The strings of the list at `key`, undefined when it is absent or null. */
  optionalStrings(key: string): string[] | undefined {
    const value = this.record[key]
    if (isAbsent(value)) {
      return undefined
    }
    return listItems(value, key).map((item) => {
      if (typeof item !== "string") {
        throw unexpected(`${key} holds a value that is not a string`)
      }
      return item
    })
  }
}
