import { RuntimeError, ValueKinds, type VariableChange } from "../../../contract/index.js"
import { EngineValues } from "./engine-values.js"

const INTEGER_LIMIT = 2_147_483_647n

const TYPE_OF_KIND = {
  string: "String",
  decimal: "Double",
  boolean: "Boolean",
  null: "Null",
  date: "Date",
  json: "Json",
  opaque: "Json",
} as const

export class VariableBody {
  static of(change: VariableChange): string {
    const text = change.valueJson.trim()
    const type = change.type ?? VariableBody.inferredType(text)
    if (!EngineValues.isWritable(type)) {
      throw new RuntimeError("rejected", `Pulse does not change variables of type ${type}.`)
    }
    const value = text === "null" ? "null" : EngineValues.formOf(type, text)
    if (value === undefined) {
      throw new RuntimeError("rejected", `The new value of ${change.name} is not a valid ${type}.`)
    }
    return `{"value":${value},"type":${JSON.stringify(type)}}`
  }

  private static inferredType(text: string): string {
    const kind = ValueKinds.ofJson(text)
    return kind === "integer" ? VariableBody.integerType(text) : TYPE_OF_KIND[kind]
  }

  private static integerType(text: string): string {
    const value = BigInt(text)
    return value <= INTEGER_LIMIT && value >= -INTEGER_LIMIT - 1n ? "Integer" : "Long"
  }
}
