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
