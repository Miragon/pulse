import type { EnginePort, IncidentScope, InstanceWithIncident } from "@miragon/pulse-c7-core"
import type { IncidentRow } from "@miragon/pulse-c7-core/runtime"
import type {
  ActivityInstanceView,
  BatchStatisticsView,
  HistoricBatchView,
  FailedJobView,
  HistoricInstanceQuery,
  HistoricInstanceView,
  IncidentQuery,
  InspectView,
  MigrationPlanView,
  MigrationReportView,
  OffsetPage,
  VariableView,
} from "./views/views.js"

export interface EngineClient {
  readonly port: EnginePort
  incidents(query: IncidentQuery, page?: OffsetPage): Promise<IncidentRow[]>
  instancesWithIncident(scope: IncidentScope): Promise<InstanceWithIncident[]>
  countWithIncident(scope: IncidentScope): Promise<number>
  withIncidentAmong(instanceIds: readonly string[]): Promise<ReadonlySet<string>>
  incident(incidentId: string): Promise<IncidentRow>
  historicInstances(query: HistoricInstanceQuery, page: OffsetPage): Promise<HistoricInstanceView[]>
  historicInstanceCount(query: HistoricInstanceQuery): Promise<number>
  inspect(instanceId: string): Promise<InspectView | undefined>
  activityInstances(instanceId: string): Promise<ActivityInstanceView>
  variables(instanceId: string): Promise<VariableView[]>
  historicVariableNames(instanceIds: readonly string[]): Promise<string[]>
  causeText(operationId: string, resourceId: string): Promise<string>
  batchStatistics(batchId: string): Promise<BatchStatisticsView | undefined>
  historicBatch(batchId: string): Promise<HistoricBatchView>
  failedJobs(jobDefinitionId: string): Promise<FailedJobView[]>
  migrationPlan(sourceDefinitionId: string, targetDefinitionId: string): Promise<MigrationPlanView>
  migrationReport(plan: MigrationPlanView): Promise<MigrationReportView>
}
