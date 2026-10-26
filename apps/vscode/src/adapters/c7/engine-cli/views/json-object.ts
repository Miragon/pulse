import { EngineCliOutputError } from "../engine-cli-output-error.js"
import { LosslessJson } from "./lossless-json.js"

type JsonRecord = Readonly<Record<string, unknown>>

export class JsonObject {
  private constructor(private readonly record: JsonRecord) {}

  static of(value: unknown, what: string): JsonObject {
    const object = JsonObject.ifObject(value)
    if (object === undefined) {
      throw new EngineCliOutputError(`${what} is not an object`)
    }
    return object
  }

  static ifObject(value: unknown): JsonObject | undefined {
    return JsonObject.isRecord(value) ? new JsonObject(value) : undefined
  }

  static listOf(value: unknown, what: string): JsonObject[] {
    return JsonObject.listItems(value, what).map((item, index) =>
      JsonObject.of(item, `${what}[${index}]`),
    )
  }

  value(key: string): unknown {
    return this.record[key]
  }

  entries(): [string, unknown][] {
    return Object.entries(this.record)
  }

  object(key: string, what: string): JsonObject {
    return JsonObject.of(this.record[key], what)
  }

  optionalString(key: string): string | undefined {
    const value = this.record[key]
    if (value === undefined || value === null) {
      return undefined
    }
    if (typeof value !== "string") {
      throw new EngineCliOutputError(`${key} is not a string`)
    }
    return value
  }

  requiredString(key: string): string {
    const value = this.optionalString(key)
    if (value === undefined) {
      throw new EngineCliOutputError(`${key} is missing`)
    }
    return value
  }

  optionalNumber(key: string): number | undefined {
    const value = this.record[key]
    if (value === undefined || value === null) {
      return undefined
    }
    if (typeof value !== "number") {
      throw new EngineCliOutputError(`${key} is not a number`)
    }
    return value
  }

  requiredNumber(key: string): number {
    const value = this.optionalNumber(key)
    if (value === undefined) {
      throw new EngineCliOutputError(`${key} is missing`)
    }
    return value
  }

  optionalList(key: string): JsonObject[] {
    const value = this.record[key]
    return value === undefined || value === null ? [] : JsonObject.listOf(value, key)
  }

  optionalStrings(key: string): string[] | undefined {
    const value = this.record[key]
    if (value === undefined || value === null) {
      return undefined
    }
    return JsonObject.listItems(value, key).map((item) => {
      if (typeof item !== "string") {
        throw new EngineCliOutputError(`${key} holds a value that is not a string`)
      }
      return item
    })
  }

  private static isRecord(value: unknown): value is JsonRecord {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      !LosslessJson.isRaw(value)
    )
  }

  private static listItems(value: unknown, what: string): readonly unknown[] {
    if (!Array.isArray(value)) {
      throw new EngineCliOutputError(`${what} is not a list`)
    }
    return value
  }
}
