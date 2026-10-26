import type { VariableCondition } from "../model/queries.js"
import type { Variable } from "../model/read-models.js"

const REGEX_SPECIALS = /[.+?^${}()|[\]\\*]/g

export class FakeVariableConditions {
  static allHold(
    variables: readonly Variable[],
    conditions: readonly VariableCondition[] | undefined,
  ): boolean {
    return (conditions ?? []).every((condition) =>
      variables.some(
        (variable) =>
          variable.name === condition.name && FakeVariableConditions.holds(variable, condition),
      ),
    )
  }

  private static holds(variable: Variable, condition: VariableCondition): boolean {
    const actual = JSON.parse(variable.valueJson) as unknown
    if (condition.operator === "like") {
      return (
        typeof actual === "string" && FakeVariableConditions.likeOf(condition.pattern).test(actual)
      )
    }
    const wanted = JSON.parse(condition.valueJson) as unknown
    switch (condition.operator) {
      case "equals":
        return actual === wanted
      case "notEquals":
        return actual !== wanted
      case "greaterThan":
        return FakeVariableConditions.difference(actual, wanted) > 0
      case "lessThan":
        return FakeVariableConditions.difference(actual, wanted) < 0
    }
  }

  private static difference(actual: unknown, wanted: unknown): number {
    return typeof actual === "number" && typeof wanted === "number" ? actual - wanted : Number.NaN
  }

  private static likeOf(pattern: string): RegExp {
    const literal = pattern
      .split("*")
      .map((part) => part.replace(REGEX_SPECIALS, "\\$&"))
      .join(".*")
    return new RegExp(`^${literal}$`, "s")
  }
}
