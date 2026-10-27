import { IsoTimestamp } from "../../model/ids.js"
import type { VariableComparison, VariableCondition } from "../../model/queries.js"

export class Conditions {
  static equals(name: string, value: string | number | null): VariableCondition {
    return { name, operator: "equals", valueJson: JSON.stringify(value) }
  }

  static notEquals(name: string, value: string | number | null): VariableCondition {
    return { name, operator: "notEquals", valueJson: JSON.stringify(value) }
  }

  static greaterThan(name: string, value: number): VariableCondition {
    return { name, operator: "greaterThan", valueJson: JSON.stringify(value) }
  }

  static lessThan(name: string, value: number): VariableCondition {
    return { name, operator: "lessThan", valueJson: JSON.stringify(value) }
  }

  static date(name: string, operator: VariableComparison, at: string): VariableCondition {
    return { name, operator, at: IsoTimestamp(at) }
  }

  static like(name: string, pattern: string): VariableCondition {
    return { name, operator: "like", pattern }
  }
}
