import { RuntimeError, type VariableCondition } from "../../../contract/index.js"

const WILDCARDS = /[\\?]/g

export class VariableFilters {
  static of(conditions: readonly VariableCondition[]): readonly Record<string, unknown>[] {
    return conditions.map((condition) => ({
      name: condition.name,
      value: VariableFilters.valueOf(condition),
    }))
  }

  private static valueOf(condition: VariableCondition): unknown {
    if (condition.operator === "like") {
      return { $like: VariableFilters.likeOf(condition.pattern) }
    }
    if (
      "at" in condition ||
      condition.operator === "greaterThan" ||
      condition.operator === "lessThan"
    ) {
      throw new RuntimeError(
        "unsupported",
        "Camunda 8 compares variables as text, so it cannot filter by greater than, less than or a date.",
      )
    }
    return condition.operator === "equals"
      ? { $eq: condition.valueJson }
      : { $notIn: [condition.valueJson] }
  }

  private static likeOf(pattern: string): string {
    const parts = pattern
      .split("*")
      .map((part) => JSON.stringify(part).slice(1, -1).replace(WILDCARDS, "\\$&"))
    return `"${parts.join("*")}"`
  }
}
