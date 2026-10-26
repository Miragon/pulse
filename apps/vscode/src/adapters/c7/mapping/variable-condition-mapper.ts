import type { VariableComparison, VariableCondition } from "../../../contract/index.js"
import { LosslessJson, type VariableQueryCondition } from "../engine-cli/index.js"
import type { Mapper } from "./mapper.js"

const OPERATORS: Readonly<Record<VariableComparison, VariableQueryCondition["operator"]>> = {
  equals: "eq",
  notEquals: "neq",
  greaterThan: "gt",
  lessThan: "lt",
}

const SQL_WILDCARDS = /[\\%_]/g

export class VariableConditionMapper implements Mapper<VariableCondition, VariableQueryCondition> {
  map(condition: VariableCondition): VariableQueryCondition {
    if (condition.operator === "like") {
      return { name: condition.name, operator: "like", value: this.likeOf(condition.pattern) }
    }
    return {
      name: condition.name,
      operator: OPERATORS[condition.operator],
      value: LosslessJson.parse(condition.valueJson),
    }
  }

  private likeOf(pattern: string): string {
    return pattern
      .split("*")
      .map((part) => part.replace(SQL_WILDCARDS, "\\$&"))
      .join("%")
  }
}
