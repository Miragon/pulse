import type {
  VariableConditionData,
  VariableOperatorCode,
  VariableValueTypeCode,
} from "./instance-list-data.js"

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/
const BOOLEANS: ReadonlySet<string> = new Set(["true", "false"])
const IMPLIED: Readonly<Partial<Record<VariableOperatorCode, VariableValueTypeCode>>> = {
  like: "text",
  greaterThan: "number",
  lessThan: "number",
}

export class VariableConditionTypes {
  static of(condition: VariableConditionData): VariableValueTypeCode {
    const named = condition.as ?? IMPLIED[condition.operator]
    if (named !== undefined) {
      return named
    }
    if (NUMBER.test(condition.value)) {
      return "number"
    }
    return BOOLEANS.has(condition.value) ? "boolean" : "text"
  }
}
