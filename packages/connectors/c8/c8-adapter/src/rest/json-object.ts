import { UnexpectedAnswerError } from "./unexpected-answer-error.js"

type JsonRecord = Readonly<Record<string, unknown>>

export class JsonObject {
  private constructor(private readonly record: JsonRecord) {}

  static of(value: unknown, what: string): JsonObject {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new UnexpectedAnswerError(`${what} is not an object`)
    }
    return new JsonObject(value as JsonRecord)
  }

  static itemsOf(value: unknown, what: string): JsonObject[] {
    const items = JsonObject.of(value, what).record.items
    if (!Array.isArray(items)) {
      throw new UnexpectedAnswerError(`${what} holds no list of items`)
    }
    return items.map((item, index) => JsonObject.of(item, `${what}[${String(index)}]`))
  }

  object(key: string): JsonObject {
    return JsonObject.of(this.record[key], key)
  }

  optionalString(key: string): string | undefined {
    const value = this.record[key]
    if (value === undefined || value === null) {
      return undefined
    }
    if (typeof value !== "string") {
      throw new UnexpectedAnswerError(`${key} is not a string`)
    }
    return value
  }

  requiredString(key: string): string {
    const value = this.optionalString(key)
    if (value === undefined) {
      throw new UnexpectedAnswerError(`${key} is missing`)
    }
    return value
  }

  optionalNumber(key: string): number | undefined {
    const value = this.record[key]
    if (value === undefined || value === null) {
      return undefined
    }
    if (typeof value !== "number") {
      throw new UnexpectedAnswerError(`${key} is not a number`)
    }
    return value
  }

  requiredNumber(key: string): number {
    const value = this.optionalNumber(key)
    if (value === undefined) {
      throw new UnexpectedAnswerError(`${key} is missing`)
    }
    return value
  }

  flag(key: string): boolean {
    return this.record[key] === true
  }
}
