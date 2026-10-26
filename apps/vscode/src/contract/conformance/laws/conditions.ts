import type { VariableCondition } from "../../model/queries.js"

export class Conditions {
  static equals(name: string, value: string | number): VariableCondition {
    return { name, operator: "equals", valueJson: JSON.stringify(value) }
  }

  static notEquals(name: string, value: string | number): VariableCondition {
    return { name, operator: "notEquals", valueJson: JSON.stringify(value) }
  }

  static greaterThan(name: string, value: number): VariableCondition {
    return { name, operator: "greaterThan", valueJson: JSON.stringify(value) }
  }

  static lessThan(name: string, value: number): VariableCondition {
    return { name, operator: "lessThan", valueJson: JSON.stringify(value) }
  }

  static like(name: string, pattern: string): VariableCondition {
    return { name, operator: "like", pattern }
  }
}
