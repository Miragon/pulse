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

export const DATE_PATTERN = "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2})?"

export const COMPARE_AS: readonly (readonly [CompareAs, string])[] = [
  ["auto", "Automatic"],
  ["text", "Text"],
  ["number", "Number"],
  ["boolean", "True or false"],
  ["date", "Date and time"],
  ["null", "Null"],
]

const OPERATOR_LABELS: Readonly<Record<VariableOperator, string>> = {
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
  date: ["equals", "notEquals", "greaterThan", "lessThan"],
  null: ["equals", "notEquals"],
}

const TYPED_OPERATOR_LABELS: Readonly<
  Partial<Record<CompareAs, Partial<Record<VariableOperator, string>>>>
> = {
  date: { greaterThan: "is after", lessThan: "is before" },
  null: { equals: "is null", notEquals: "is not null" },
}

const NUMBER = new RegExp(`^${NUMBER_PATTERN}$`)
const DATE = new RegExp(`^${DATE_PATTERN}$`)
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

  static operatorLabel(compareAs: CompareAs, operator: VariableOperator): string {
    return TYPED_OPERATOR_LABELS[compareAs]?.[operator] ?? OPERATOR_LABELS[operator]
  }

  static withCompareAs(draft: Draft, compareAs: CompareAs): Draft {
    const value = VariableDraft.valueFor(compareAs, draft.value)
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
    const value = VariableDraft.valueError(draft)
    return {
      ...(draft.name.trim() === "" ? { name: "Enter a variable name." } : {}),
      ...(value === undefined ? {} : { value }),
      ...(others >= MAX_CONDITIONS ? { count: `Use ${MAX_CONDITIONS} conditions or fewer.` } : {}),
    }
  }

  private static valueError(draft: Draft): string | undefined {
    if (draft.compareAs === "date") {
      return DATE.test(draft.value) ? undefined : "Pick a date and time."
    }
    const needsNumber = draft.compareAs === "number" || NUMBER_OPERATORS.has(draft.operator)
    return needsNumber && !NUMBER.test(draft.value)
      ? "Enter a number, for example 42 or 9.5."
      : undefined
  }

  private static valueFor(compareAs: CompareAs, value: string): string {
    if (compareAs === "boolean") {
      return value === "false" ? "false" : "true"
    }
    if (compareAs === "null" || (compareAs === "date" && !DATE.test(value))) {
      return ""
    }
    return value
  }
}
