import type { VariableConditionView, VariableOperator, VariableValueType } from "./view-models.js"

export const MAX_VARIABLE_CONDITIONS = 5

const BOOLEANS: ReadonlySet<string> = new Set(["true", "false"])
const SYMBOLS: Readonly<Record<VariableOperator, string>> = {
  equals: "=",
  notEquals: "≠",
  greaterThan: ">",
  lessThan: "<",
  like: "matches",
}
const IMPLIED_TYPES: Readonly<Partial<Record<VariableOperator, VariableValueType>>> = {
  like: "text",
  greaterThan: "number",
  lessThan: "number",
}
const OPERATORS_OF: Readonly<Record<VariableValueType, readonly VariableOperator[]>> = {
  text: ["equals", "notEquals", "like"],
  number: ["equals", "notEquals", "greaterThan", "lessThan"],
  boolean: ["equals", "notEquals"],
}

export class VariableConditionRules {
  static readonly NUMBER_PATTERN = "-?(?:0|[1-9]\\d*)(?:\\.\\d+)?"

  private static readonly NUMBER = new RegExp(`^${VariableConditionRules.NUMBER_PATTERN}$`)

  static isOperator(value: unknown): value is VariableOperator {
    return typeof value === "string" && Object.hasOwn(SYMBOLS, value)
  }

  static isValueType(value: unknown): value is VariableValueType {
    return typeof value === "string" && Object.hasOwn(OPERATORS_OF, value)
  }

  static isNumber(text: string): boolean {
    return VariableConditionRules.NUMBER.test(text)
  }

  static typeOf(condition: VariableConditionView): VariableValueType {
    if (condition.as !== undefined) {
      return condition.as
    }
    const implied = IMPLIED_TYPES[condition.operator]
    if (implied !== undefined) {
      return implied
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
