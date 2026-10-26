import type { VariableConditionView, VariableOperator, VariableValueType } from "./view-models.js"

export const MAX_VARIABLE_CONDITIONS = 5

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/
const BOOLEANS: ReadonlySet<string> = new Set(["true", "false"])
const SYMBOLS: Readonly<Record<VariableOperator, string>> = {
  equals: "=",
  notEquals: "≠",
  greaterThan: ">",
  lessThan: "<",
  like: "matches",
}
const OPERATORS_OF: Readonly<Record<VariableValueType, readonly VariableOperator[]>> = {
  text: ["equals", "notEquals", "like"],
  number: ["equals", "notEquals", "greaterThan", "lessThan"],
  boolean: ["equals", "notEquals"],
}

export class VariableConditionRules {
  static isNumber(text: string): boolean {
    return NUMBER.test(text)
  }

  static typeOf(condition: VariableConditionView): VariableValueType {
    if (condition.as !== undefined) {
      return condition.as
    }
    if (condition.operator === "like") {
      return "text"
    }
    if (VariableConditionRules.isNumber(condition.value)) {
      return "number"
    }
    return BOOLEANS.has(condition.value) ? "boolean" : "text"
  }

  static operatorsOf(type: VariableValueType): readonly VariableOperator[] {
    return OPERATORS_OF[type]
  }

  static fits(condition: VariableConditionView): boolean {
    const type = VariableConditionRules.typeOf(condition)
    return (
      condition.name.trim() !== "" &&
      OPERATORS_OF[type].includes(condition.operator) &&
      VariableConditionRules.valueFits(type, condition.value)
    )
  }

  static label(condition: VariableConditionView): string {
    const shown =
      VariableConditionRules.typeOf(condition) === "text"
        ? JSON.stringify(condition.value)
        : condition.value
    return `${condition.name} ${SYMBOLS[condition.operator]} ${shown}`
  }

  private static valueFits(type: VariableValueType, value: string): boolean {
    if (type === "number") {
      return VariableConditionRules.isNumber(value)
    }
    return type === "boolean" ? BOOLEANS.has(value) : true
  }
}
