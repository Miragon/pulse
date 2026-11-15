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
  MigrationPlanView,
  MigrationReportView,
} from "./views/views.js"

export interface EngineClient {
  readonly port: EnginePort
  historicInstances(
    query: HistoricInstanceQuery,
    page: OffsetWindow,
  ): Promise<HistoricInstanceRow[]>
  activityInstances(instanceId: string): Promise<ActivityInstanceView>
  batchStatistics(batchId: string): Promise<BatchStatisticsView | undefined>
  historicBatch(batchId: string): Promise<HistoricBatchView>
  failedJobs(jobDefinitionId: string): Promise<FailedJobView[]>
  migrationPlan(sourceDefinitionId: string, targetDefinitionId: string): Promise<MigrationPlanView>
  migrationReport(plan: MigrationPlanView): Promise<MigrationReportView>
}
