import type { ValueKind } from "./read-models.js"

const INTEGER = /^-?\d+$/
const DECIMAL = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/
const LITERALS: Readonly<Record<string, ValueKind>> = {
  true: "boolean",
  false: "boolean",
  null: "null",
}

export class ValueKinds {
  static readonly WHOLE_NUMBER_MIN = 0n - 2n ** 63n
  static readonly WHOLE_NUMBER_MAX = 2n ** 63n - 1n

  static ofJson(valueJson: string): ValueKind {
    const text = valueJson.trim()
    if (text.startsWith('"')) {
      return "string"
    }
    if (INTEGER.test(text)) {
      return "integer"
    }
    if (DECIMAL.test(text)) {
      return "decimal"
    }
    return LITERALS[text] ?? "json"
  }

  static isWholeNumber(valueJson: string): boolean {
    const text = valueJson.trim()
    if (!INTEGER.test(text)) {
      return false
    }
    const value = BigInt(text)
    return value >= ValueKinds.WHOLE_NUMBER_MIN && value <= ValueKinds.WHOLE_NUMBER_MAX
  }

  static isFiniteNumber(valueJson: string): boolean {
    const text = valueJson.trim()
    return DECIMAL.test(text) && Number.isFinite(Number(text))
  }
}
