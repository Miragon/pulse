import type {
  IsoTimestamp,
  VariableComparison,
  VariableCondition,
} from "../../../contract/index.js"
import { LosslessJson, type VariableQueryCondition } from "../engine-rest/index.js"
import type { Mapper } from "./mapper.js"

const OPERATORS: Readonly<Record<VariableComparison, VariableQueryCondition["operator"]>> = {
  equals: "eq",
  notEquals: "neq",
  greaterThan: "gt",
  lessThan: "lt",
}

const SQL_WILDCARDS = /[\\%_]/g
const ENGINE_UTC_OFFSET = "+0000"

export class VariableConditionMapper implements Mapper<VariableCondition, VariableQueryCondition> {
  map(condition: VariableCondition): VariableQueryCondition {
    if (condition.operator === "like") {
      return { name: condition.name, operator: "like", value: this.likeOf(condition.pattern) }
    }
    return {
      name: condition.name,
      operator: OPERATORS[condition.operator],
      value:
        "at" in condition ? this.dateOf(condition.at) : LosslessJson.parse(condition.valueJson),
    }
  }

  private dateOf(at: IsoTimestamp): string {
    return new Date(at).toISOString().replace("Z", ENGINE_UTC_OFFSET)
  }

  private likeOf(pattern: string): string {
    return pattern
      .split("*")
      .map((part) => part.replace(SQL_WILDCARDS, "\\$&"))
      .join("%")
  }
}
