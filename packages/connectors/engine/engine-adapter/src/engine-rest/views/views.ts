import type {
  DefinitionView as InspectedDefinitionView,
  InstanceView,
  TimelineEntry,
} from "@miragon/pulse-engine-core"

export interface ProductView {
  readonly name: string
  readonly version: string
}

export interface DefinitionView {
  readonly id: string
  readonly key: string
  readonly version: number
  readonly name?: string
  readonly deploymentId?: string
  readonly versionTag?: string
}

export interface DefinitionStatisticsView {
  readonly definition: DefinitionView
  readonly instances: number
}

export interface ActivityStatisticsView {
  readonly activityId: string
  readonly instances: number
}

export interface IncidentView {
  readonly id: string
  readonly incidentType: string
  readonly activityId: string
  readonly processInstanceId?: string
  readonly processDefinitionId?: string
  readonly incidentMessage?: string
  readonly incidentTimestamp: string
  readonly rootCauseIncidentId?: string
  readonly configuration?: string
}

export interface IncidentInstanceView {
  readonly processDefinitionId?: string
  readonly processInstanceId?: string
}

export interface HistoricInstanceView {
  readonly id: string
  readonly businessKey?: string
  readonly processDefinitionId: string
  readonly processDefinitionKey: string
  readonly processDefinitionVersion: number
  readonly processDefinitionName?: string
  readonly state: string
  readonly startTime?: string
  readonly endTime?: string
  readonly superProcessInstanceId?: string
}

export interface VariableView {
  readonly name: string
  readonly type?: string
  readonly valueJson: string
  readonly scopeElementId?: string
}

export interface BatchRef {
  readonly id: string
}

export interface BatchView extends BatchRef {
  readonly type: string
  readonly totalJobs: number
  readonly invocationsPerBatchJob: number
  readonly batchJobDefinitionId?: string
  readonly startTime?: string
}

export interface BatchStatisticsView extends BatchView {
  readonly suspended: boolean
  readonly completedJobs: number
  readonly failedJobs: number
}

export interface HistoricBatchView extends BatchView {
  readonly endTime?: string
}

export interface FailedJobView {
  readonly id: string
  readonly exceptionMessage?: string
}

export interface MigrationInstructionView {
  readonly sourceActivityIds: readonly string[]
  readonly targetActivityIds: readonly string[]
}

export interface MigrationPlanView {
  readonly sourceProcessDefinitionId: string
  readonly targetProcessDefinitionId: string
  readonly instructions: readonly MigrationInstructionView[]
}

export interface MigrationInstructionReportView {
  readonly instruction: MigrationInstructionView
  readonly failures: readonly string[]
}

export interface MigrationReportView {
  readonly instructionReports: readonly MigrationInstructionReportView[]
}

export type InspectView = InstanceView & {
  readonly definition: InspectedDefinitionView & { readonly version: number }
  readonly timeline: readonly TimelineEntry[]
}

export interface IncidentQuery {
  readonly processDefinitionId?: string
  readonly processDefinitionKeyIn?: readonly string[]
  readonly processInstanceId?: string
}

export interface VariableQueryCondition {
  readonly name: string
  readonly operator: "eq" | "neq" | "gt" | "lt" | "like"
  readonly value: unknown
}

export interface HistoricInstanceQuery {
  readonly processDefinitionId?: string
  readonly processDefinitionKey?: string
  readonly processInstanceIds?: readonly string[]
  readonly processInstanceBusinessKey?: string
  readonly unfinished?: true
  readonly finished?: true
  readonly incidentStatus?: "open"
  readonly activityIdIn?: readonly string[]
  readonly variables?: readonly VariableQueryCondition[]
}

export interface OffsetPage {
  readonly firstResult: number
  readonly maxResults: number
}

export interface TransitionInstanceView {
  readonly id: string
  readonly activityId: string
}

export interface ActivityInstanceView {
  readonly id: string
  readonly activityId: string
  readonly childActivityInstances: readonly ActivityInstanceView[]
  readonly childTransitionInstances: readonly TransitionInstanceView[]
}
