import type { InstanceStateCode } from "./instance-screen-data.js"

export type InstanceScopeCode = "running" | "withIncident" | "ended" | "all"

export type VariableOperatorCode = "equals" | "notEquals" | "like" | "greaterThan" | "lessThan"

export type VariableValueTypeCode = "text" | "number" | "boolean" | "date" | "null"

export type VariableConditionKindCode = "ordering" | "date"

export interface VariableConditionData {
  readonly name: string
  readonly operator: VariableOperatorCode
  readonly value: string
  readonly as?: VariableValueTypeCode
}

export interface InstanceListFilterData {
  readonly scope: InstanceScopeCode
  readonly elementId?: string
  readonly businessKey?: string
  readonly variables?: readonly VariableConditionData[]
}

export type ScopeCountsData = Readonly<Record<InstanceScopeCode, number>> & {
  readonly atLeast?: readonly InstanceScopeCode[]
}

export interface InstanceRowData {
  readonly id: string
  readonly state: InstanceStateCode
  readonly hasIncident: boolean
  readonly businessKey?: string
  readonly startedAt?: string
}

export interface InstanceListData {
  readonly engine: string
  readonly asOf: string
  readonly definitionId: string
  readonly rows: readonly InstanceRowData[]
  readonly next: string | null
  readonly counts: ScopeCountsData | null
  readonly refusedVariableConditions: readonly VariableConditionKindCode[]
}
