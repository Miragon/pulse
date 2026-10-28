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

export interface WaitingAtView {
  readonly kind: string
  readonly activityId: string
  readonly activityName?: string
  readonly activityType?: string
  readonly attachedTo?: string
  readonly processInstanceId?: string
  readonly since?: string
  readonly incidentId?: string
  readonly assignee?: string
  readonly due?: string
  readonly dueDate?: string
  readonly topic?: string
  readonly retries?: number
  readonly eventName?: string
}

interface StacktraceView {
  readonly lines: readonly string[]
  readonly truncated: boolean
}

export interface InspectedIncidentView {
  readonly id: string
  readonly type: string
  readonly activityId: string
  readonly processInstanceId?: string
  readonly message?: string
  readonly since: string
  readonly jobId?: string
  readonly externalTaskId?: string
  readonly stacktrace?: StacktraceView
}

export interface ChildInstanceView {
  readonly id: string
  readonly parentId: string
  readonly key: string
  readonly state: string
}

interface TimelineEntryView {
  readonly activityId: string
  readonly activityName?: string
  readonly startTime: string
  readonly endTime?: string
  readonly canceled: boolean
}

interface CallView {
  readonly activityId: string
  readonly calledProcessInstanceId: string
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

export interface InspectView {
  readonly id: string
  readonly businessKey?: string
  readonly definition: DefinitionView
  readonly state: string
  readonly startTime?: string
  readonly endTime?: string
  readonly parentId?: string
  readonly waitingAt: readonly WaitingAtView[]
  readonly incidents: readonly InspectedIncidentView[]
  readonly propagatedIncidents: number
  readonly children: readonly ChildInstanceView[]
  readonly calls: readonly CallView[]
  readonly timeline: readonly TimelineEntryView[]
  readonly variables: readonly VariableView[]
  readonly truncated: boolean
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
