import type { IncidentScope, InstanceWithIncident } from "@miragon/pulse-c7-core"
import type {
  ActivityInstanceView,
  ActivityStatisticsView,
  BatchStatisticsView,
  HistoricBatchView,
  DefinitionStatisticsView,
  FailedJobView,
  HistoricInstanceQuery,
  HistoricInstanceView,
  IncidentQuery,
  IncidentView,
  InspectView,
  MigrationPlanView,
  MigrationReportView,
  OffsetPage,
  ProductView,
  VariableView,
} from "./views/views.js"

export interface EngineClient {
  product(): Promise<ProductView>
  version(): Promise<string>
  definitionStatistics(): Promise<DefinitionStatisticsView[]>
  activityStatistics(definitionId: string): Promise<ActivityStatisticsView[]>
  diagramXml(definitionId: string): Promise<string>
  incidents(query: IncidentQuery, page?: OffsetPage): Promise<IncidentView[]>
  instancesWithIncident(scope: IncidentScope): Promise<InstanceWithIncident[]>
  countWithIncident(scope: IncidentScope): Promise<number>
  withIncidentAmong(instanceIds: readonly string[]): Promise<ReadonlySet<string>>
  incident(incidentId: string): Promise<IncidentView>
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
