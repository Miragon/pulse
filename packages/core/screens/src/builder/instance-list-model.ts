import type {
  DefinitionId,
  InstanceSummary,
  Page,
  PageCursor,
  ProcessRuntime,
  VariableConditionKind,
} from "@miragon/pulse-engine-core"
import type { InstanceListFilterData, InstanceScopeCode } from "../format/instance-list-data.js"

export type InstanceCountReads = Pick<ProcessRuntime, "countInstances">

export type InstancePageReads = Pick<ProcessRuntime, "searchInstances">

export type InstanceListReads = Pick<
  ProcessRuntime,
  "searchInstances" | "countInstances" | "refusedVariableConditions"
>

export interface InstanceListRequest {
  readonly definitionId: DefinitionId
  readonly filter: InstanceListFilterData
  readonly after?: PageCursor
}

export type ScopeCountsModel = Readonly<Record<InstanceScopeCode, number>> & {
  readonly atLeast?: readonly InstanceScopeCode[]
}

export interface InstanceListFacts {
  readonly engine: string
  readonly asOf: Date
  readonly definitionId: DefinitionId
  readonly page: Page<InstanceSummary>
  readonly counts: ScopeCountsModel | undefined
  readonly refusedVariableConditions: readonly VariableConditionKind[]
}

export interface InstanceListModel {
  readonly engine: string
  readonly asOf: Date
  readonly definitionId: DefinitionId
  readonly rows: readonly InstanceSummary[]
  readonly next: PageCursor | undefined
  readonly counts: ScopeCountsModel | undefined
  readonly refusedVariableConditions: readonly VariableConditionKind[]
}
