import type {
  VariableConditionData,
  VariableConditionKindCode,
  VariableOperatorCode,
  VariableValueTypeCode,
} from "@miragon/pulse-screens"

/** How the dialog compares a value: by what it reads as (`auto`), or as the type named. */
export type CompareAs = "auto" | VariableValueTypeCode

/** A condition as the dialog edits it, its value as typed. */
export interface VariableDraftData {
  readonly name: string
  readonly operator: VariableOperatorCode
  readonly value: string
  readonly compareAs: CompareAs
}

/**
 * What is wrong with a draft, by field: a missing name, a value that is no number or no date, a
 * condition over the limit, a kind of condition the engine refuses (a date at Compare as, an
 * ordering at Operator).
 */
export interface VariableDraftErrors {
  readonly name?: "missing"
  readonly value?: "number" | "date"
  readonly count?: "tooMany"
  readonly refused?: VariableConditionKindCode
}

const COMPARE_AS: readonly CompareAs[] = ["auto", "text", "number", "boolean", "date", "null"]

const OPERATORS_OF: Readonly<Record<CompareAs, readonly VariableOperatorCode[]>> = {
  auto: ["equals", "notEquals", "like", "greaterThan", "lessThan"],
  text: ["equals", "notEquals", "like"],
  number: ["equals", "notEquals", "greaterThan", "lessThan"],
  boolean: ["equals", "notEquals"],
  date: ["equals", "notEquals", "greaterThan", "lessThan"],
  null: ["equals", "notEquals"],
}

const ORDERING: ReadonlySet<VariableOperatorCode> = new Set(["greaterThan", "lessThan"])

const NUMBER_PATTERN = "-?(?:0|[1-9]\\d*)(?:\\.\\d+)?"

const DATE_PATTERN = "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2})?"

const NUMBER = new RegExp(`^${NUMBER_PATTERN}$`)

const DATE = new RegExp(`^${DATE_PATTERN}$`)

/**
 * The rules of the variable condition dialog, without words: its types and their operators, what a
 * value must look like, the limit of conditions and the kinds an engine refuses (Camunda 8: a date
 * and greater or less than), which the dialog offers disabled with their reason (the owner,
 * 2026-11-20). A surface that validates the conditions it receives holds its rules to these.
 */
export class VariableDraft {
  /** At most this many conditions filter a list. */
  static readonly MAX_CONDITIONS = 5

  /** A number as the engine reads one: no exponent, no leading zero, a dot before decimals. */
  static readonly NUMBER_PATTERN = NUMBER_PATTERN

  /** A date and time as `datetime-local` gives it, seconds optional, without an offset. */
  static readonly DATE_PATTERN = DATE_PATTERN

  /** The operators each way of comparing offers. */
  static readonly OPERATORS_OF = OPERATORS_OF

  static from(condition: VariableConditionData | undefined): VariableDraftData {
    return {
      name: condition?.name ?? "",
      operator: condition?.operator ?? "equals",
      value: condition?.value ?? "",
      compareAs: condition?.as ?? "auto",
    }
  }

  /** Every way of comparing, in the dialog's order, those an engine refuses included. */
  static compareAsOptions(): readonly CompareAs[] {
    return COMPARE_AS
  }

  static operatorsOf(compareAs: CompareAs): readonly VariableOperatorCode[] {
    return OPERATORS_OF[compareAs]
  }

  /**
   * The kind of condition the engine refuses that a choice makes: a date where it refuses dates,
   * greater or less than on anything but a date where it refuses ordering; none where it takes it.
   */
  static refusedKind(
    compareAs: CompareAs,
    operator: VariableOperatorCode | undefined,
    refused: readonly VariableConditionKindCode[],
  ): VariableConditionKindCode | undefined {
    if (compareAs === "date") {
      return refused.includes("date") ? "date" : undefined
    }
    const ordering = operator !== undefined && ORDERING.has(operator)
    return ordering && refused.includes("ordering") ? "ordering" : undefined
  }

  /** The draft compared another way: its value kept where it fits, its operator where offered. */
  static withCompareAs(
    draft: VariableDraftData,
    compareAs: CompareAs,
    refused: readonly VariableConditionKindCode[] = [],
  ): VariableDraftData {
    const value = VariableDraft.valueFor(compareAs, draft.value)
    const kept =
      OPERATORS_OF[compareAs].includes(draft.operator) &&
      VariableDraft.refusedKind(compareAs, draft.operator, refused) !== "ordering"
    return { ...draft, compareAs, value, operator: kept ? draft.operator : "equals" }
  }

  static condition(draft: VariableDraftData): VariableConditionData {
    return {
      name: draft.name.trim(),
      operator: draft.operator,
      value: draft.value,
      ...(draft.compareAs === "auto" ? {} : { as: draft.compareAs }),
    }
  }

  /** What is wrong with a draft, with `others` conditions beside it; nothing for one to apply. */
  static errors(
    draft: VariableDraftData,
    others: number,
    refused: readonly VariableConditionKindCode[] = [],
  ): VariableDraftErrors {
    const value = VariableDraft.valueError(draft)
    const kind = VariableDraft.refusedKind(draft.compareAs, draft.operator, refused)
    return {
      ...(draft.name.trim() === "" ? { name: "missing" } : {}),
      ...(value === undefined ? {} : { value }),
      ...(others >= VariableDraft.MAX_CONDITIONS ? { count: "tooMany" } : {}),
      ...(kind === undefined ? {} : { refused: kind }),
    }
  }

  private static valueError(draft: VariableDraftData): VariableDraftErrors["value"] {
    if (draft.compareAs === "date") {
      return DATE.test(draft.value) ? undefined : "date"
    }
    const needsNumber = draft.compareAs === "number" || ORDERING.has(draft.operator)
    return needsNumber && !NUMBER.test(draft.value) ? "number" : undefined
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
