import type {
  VariableConditionView,
  VariableOperator,
  VariableValueType,
} from "../../core/protocol/index.js"

export type CompareAs = "auto" | VariableValueType

export interface Draft {
  readonly name: string
  readonly operator: VariableOperator
  readonly value: string
  readonly compareAs: CompareAs
}

export interface DraftErrors {
  readonly name?: string
  readonly value?: string
  readonly count?: string
}

export const MAX_CONDITIONS = 5

export const NUMBER_PATTERN = "-?(?:0|[1-9]\\d*)(?:\\.\\d+)?"

export const COMPARE_AS: readonly (readonly [CompareAs, string])[] = [
  ["auto", "Automatic"],
  ["text", "Text"],
  ["number", "Number"],
  ["boolean", "True or false"],
]

export const OPERATOR_LABELS: Readonly<Record<VariableOperator, string>> = {
  equals: "is",
  notEquals: "is not",
  like: "matches",
  greaterThan: "is greater than",
  lessThan: "is less than",
}

export const OPERATORS_OF: Readonly<Record<CompareAs, readonly VariableOperator[]>> = {
  auto: ["equals", "notEquals", "like", "greaterThan", "lessThan"],
  text: ["equals", "notEquals", "like"],
  number: ["equals", "notEquals", "greaterThan", "lessThan"],
  boolean: ["equals", "notEquals"],
}

const NUMBER = new RegExp(`^${NUMBER_PATTERN}$`)
const NUMBER_OPERATORS: ReadonlySet<VariableOperator> = new Set(["greaterThan", "lessThan"])

export class VariableDraft {
  static from(condition: VariableConditionView | undefined): Draft {
    return {
      name: condition?.name ?? "",
      operator: condition?.operator ?? "equals",
      value: condition?.value ?? "",
      compareAs: condition?.as ?? "auto",
    }
  }

  static withCompareAs(draft: Draft, compareAs: CompareAs): Draft {
    const value = compareAs === "boolean" && draft.value !== "false" ? "true" : draft.value
    const operator = OPERATORS_OF[compareAs].includes(draft.operator) ? draft.operator : "equals"
    return { ...draft, compareAs, value, operator }
  }

  static condition(draft: Draft): VariableConditionView {
    return {
      name: draft.name.trim(),
      operator: draft.operator,
      value: draft.value,
      ...(draft.compareAs === "auto" ? {} : { as: draft.compareAs }),
    }
  }

  static errors(draft: Draft, others: number): DraftErrors {
    const needsNumber = draft.compareAs === "number" || NUMBER_OPERATORS.has(draft.operator)
    return {
      ...(draft.name.trim() === "" ? { name: "Enter a variable name." } : {}),
      ...(needsNumber && !NUMBER.test(draft.value)
        ? { value: "Enter a number, for example 42 or 9.5." }
        : {}),
      ...(others >= MAX_CONDITIONS ? { count: `Use ${MAX_CONDITIONS} conditions or fewer.` } : {}),
    }
  }
}
