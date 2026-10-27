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
  date: ["equals", "notEquals", "greaterThan", "lessThan"],
  null: ["equals", "notEquals"],
}

const SHOWN_VALUES: Readonly<Record<VariableValueType, (value: string) => string>> = {
  text: (value) => JSON.stringify(value),
  number: (value) => value,
  boolean: (value) => value,
  date: (value) => value.replace("T", " "),
  null: () => "null",
}
const VALUE_FITS: Readonly<Record<VariableValueType, (value: string) => boolean>> = {
  text: () => true,
  number: (value) => VariableConditionRules.isNumber(value),
  boolean: (value) => BOOLEANS.has(value),
  date: (value) => VariableConditionRules.isDate(value),
  null: (value) => value === "",
}

export class VariableConditionRules {
  static readonly NUMBER_PATTERN = "-?(?:0|[1-9]\\d*)(?:\\.\\d+)?"

  static readonly DATE_PATTERN = "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2})?"

  private static readonly NUMBER = new RegExp(`^${VariableConditionRules.NUMBER_PATTERN}$`)

  private static readonly DATE = new RegExp(`^${VariableConditionRules.DATE_PATTERN}$`)

  static isOperator(value: unknown): value is VariableOperator {
    return typeof value === "string" && Object.hasOwn(SYMBOLS, value)
  }

  static isValueType(value: unknown): value is VariableValueType {
    return typeof value === "string" && Object.hasOwn(OPERATORS_OF, value)
  }

  static isNumber(text: string): boolean {
    return VariableConditionRules.NUMBER.test(text)
  }

  static isDate(text: string): boolean {
    return VariableConditionRules.DATE.test(text) && !Number.isNaN(Date.parse(text))
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
    const shown = SHOWN_VALUES[VariableConditionRules.typeOf(condition)](condition.value)
    return `${condition.name} ${SYMBOLS[condition.operator]} ${shown}`
  }

  private static valueFits(type: VariableValueType, value: string): boolean {
    return VALUE_FITS[type](value)
  }
}
