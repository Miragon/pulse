import type { EngineCliRunnerOptions } from "./running/engine-cli-runner.js"
import type {
  ActivityInstanceView,
  ActivityStatisticsView,
  BatchStatisticsView,
  HistoricBatchView,
  DefinitionStatisticsView,
  FailedJobView,
  HistoricInstanceQuery,
  HistoricInstanceView,
  IncidentInstanceView,
  IncidentQuery,
  IncidentView,
  InspectView,
  MigrationPlanView,
  MigrationReportView,
  OffsetPage,
  ProductView,
  VariableView,
} from "./views/views.js"

export type EngineClientOptions = EngineCliRunnerOptions

export interface EngineClient {
  product(): Promise<ProductView>
  version(): Promise<string>
  definitionStatistics(): Promise<DefinitionStatisticsView[]>
  activityStatistics(definitionId: string): Promise<ActivityStatisticsView[]>
  diagramXml(definitionId: string): Promise<string>
  incidents(query: IncidentQuery, page?: OffsetPage): Promise<IncidentView[]>
  incidentInstances(): Promise<IncidentInstanceView[]>
  incident(incidentId: string): Promise<IncidentView>
  historicInstances(query: HistoricInstanceQuery, page: OffsetPage): Promise<HistoricInstanceView[]>
  historicInstanceCount(query: HistoricInstanceQuery): Promise<number>
  inspect(instanceId: string): Promise<InspectView>
  activityInstances(instanceId: string): Promise<ActivityInstanceView>
  variables(instanceId: string): Promise<VariableView[]>
  jobStacktrace(jobId: string): Promise<string>
  externalTaskErrorDetails(externalTaskId: string): Promise<string>
  batchStatistics(batchId: string): Promise<BatchStatisticsView | undefined>
  historicBatch(batchId: string): Promise<HistoricBatchView>
  failedJobs(jobDefinitionId: string): Promise<FailedJobView[]>
  migrationPlan(sourceDefinitionId: string, targetDefinitionId: string): Promise<MigrationPlanView>
  migrationReport(plan: MigrationPlanView): Promise<MigrationReportView>
}
