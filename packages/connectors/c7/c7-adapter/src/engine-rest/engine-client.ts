import type { EnginePort } from "@miragon/pulse-c7-core"
import type {
  HistoricInstanceQuery,
  HistoricInstanceRow,
  OffsetWindow,
} from "@miragon/pulse-c7-core/runtime"
import type {
  ActivityInstanceView,
  BatchStatisticsView,
  HistoricBatchView,
  FailedJobView,
  InspectView,
  MigrationPlanView,
  MigrationReportView,
  VariableView,
} from "./views/views.js"

export interface EngineClient {
  readonly port: EnginePort
  historicInstances(
    query: HistoricInstanceQuery,
    page: OffsetWindow,
  ): Promise<HistoricInstanceRow[]>
  inspect(instanceId: string): Promise<InspectView | undefined>
  activityInstances(instanceId: string): Promise<ActivityInstanceView>
  variables(instanceId: string): Promise<VariableView[]>
  batchStatistics(batchId: string): Promise<BatchStatisticsView | undefined>
  historicBatch(batchId: string): Promise<HistoricBatchView>
  failedJobs(jobDefinitionId: string): Promise<FailedJobView[]>
  migrationPlan(sourceDefinitionId: string, targetDefinitionId: string): Promise<MigrationPlanView>
  migrationReport(plan: MigrationPlanView): Promise<MigrationReportView>
}
