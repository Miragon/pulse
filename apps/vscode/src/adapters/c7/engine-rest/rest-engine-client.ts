import type { EngineClient } from "./engine-client.js"
import type { EngineHttp } from "./http/engine-http.js"
import { InstanceInspection } from "./inspect/instance-inspection.js"
import { RequestArguments } from "./request-arguments.js"
import { ActivityInstanceViewParser } from "./views/activity-instance-view-parser.js"
import { BatchViewParser } from "./views/batch-view-parser.js"
import { DefinitionViewParser } from "./views/definition-view-parser.js"
import { EngineViewParser } from "./views/engine-view-parser.js"
import { HistoricInstanceViewParser } from "./views/historic-instance-view-parser.js"
import { IncidentViewParser } from "./views/incident-view-parser.js"
import { MigrationViewParser } from "./views/migration-view-parser.js"
import { VariableViewParser } from "./views/variable-view-parser.js"
import type {
  ActivityInstanceView,
  ActivityStatisticsView,
  BatchStatisticsView,
  DefinitionStatisticsView,
  FailedJobView,
  HistoricBatchView,
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

export const VARIABLE_PAGE_SIZE = 500
const MAX_NAMED_VARIABLES = 2000
const MAX_FAILED_JOBS = 100
const NO_VALUES = { deserializeValues: "false" }
const NEWEST_FIRST = [
  { sortBy: "startTime", sortOrder: "desc" },
  { sortBy: "instanceId", sortOrder: "asc" },
]

export class RestEngineClient implements EngineClient {
  constructor(private readonly http: EngineHttp) {}

  async product(): Promise<ProductView> {
    return EngineViewParser.product(await this.http.read("/telemetry/data"))
  }

  async version(): Promise<string> {
    return EngineViewParser.version(await this.http.read("/version"))
  }

  async definitionStatistics(): Promise<DefinitionStatisticsView[]> {
    return DefinitionViewParser.definitionStatistics(
      await this.http.read("/process-definition/statistics"),
    )
  }

  async activityStatistics(definitionId: string): Promise<ActivityStatisticsView[]> {
    return DefinitionViewParser.activityStatistics(
      await this.http.read(
        `/process-definition/${RequestArguments.segment(definitionId)}/statistics`,
      ),
    )
  }

  async diagramXml(definitionId: string): Promise<string> {
    return DefinitionViewParser.diagramXml(
      await this.http.read(`/process-definition/${RequestArguments.segment(definitionId)}/xml`),
    )
  }

  async incidents(query: IncidentQuery, page?: OffsetPage): Promise<IncidentView[]> {
    const filter = {
      processDefinitionId: RequestArguments.optionalIdentifier(query.processDefinitionId),
      processDefinitionKeyIn: RequestArguments.identifierList(query.processDefinitionKeyIn),
      processInstanceId: RequestArguments.optionalIdentifier(query.processInstanceId),
      sortBy: "incidentTimestamp",
      sortOrder: "desc",
    }
    return IncidentViewParser.incidents(
      page === undefined
        ? await this.http.readAll("/incident", filter)
        : await this.http.read("/incident", { ...filter, ...RestEngineClient.pageOf(page) }),
    )
  }

  async incidentInstances(): Promise<IncidentInstanceView[]> {
    return IncidentViewParser.incidentInstances(await this.http.readAll("/incident"))
  }

  async incident(incidentId: string): Promise<IncidentView> {
    return IncidentViewParser.incident(
      await this.http.read(`/incident/${RequestArguments.segment(incidentId)}`),
    )
  }

  async historicInstances(
    query: HistoricInstanceQuery,
    page: OffsetPage,
  ): Promise<HistoricInstanceView[]> {
    return HistoricInstanceViewParser.instances(
      await this.http.read("/history/process-instance", RestEngineClient.pageOf(page), {
        ...query,
        sorting: NEWEST_FIRST,
      }),
    )
  }

  async historicInstanceCount(query: HistoricInstanceQuery): Promise<number> {
    return HistoricInstanceViewParser.count(
      await this.http.read("/history/process-instance/count", {}, query),
    )
  }

  async inspect(instanceId: string): Promise<InspectView | undefined> {
    return new InstanceInspection(this.http).inspect(RequestArguments.identifier(instanceId))
  }

  async activityInstances(instanceId: string): Promise<ActivityInstanceView> {
    return ActivityInstanceViewParser.tree(
      await this.http.read(
        `/process-instance/${RequestArguments.segment(instanceId)}/activity-instances`,
      ),
    )
  }

  async variables(instanceId: string): Promise<VariableView[]> {
    return VariableViewParser.instances(
      await this.http.read("/variable-instance", {
        processInstanceIdIn: RequestArguments.identifier(instanceId),
        ...NO_VALUES,
        maxResults: String(VARIABLE_PAGE_SIZE),
      }),
    )
  }

  async historicVariableNames(instanceIds: readonly string[]): Promise<string[]> {
    return VariableViewParser.names(
      await this.http.read(
        "/history/variable-instance",
        { ...NO_VALUES, maxResults: String(MAX_NAMED_VARIABLES) },
        { processInstanceIdIn: instanceIds },
      ),
    )
  }

  jobStacktrace(jobId: string): Promise<string> {
    return this.http.text(`/job/${RequestArguments.segment(jobId)}/stacktrace`)
  }

  externalTaskErrorDetails(externalTaskId: string): Promise<string> {
    return this.http.text(`/external-task/${RequestArguments.segment(externalTaskId)}/errorDetails`)
  }

  async batchStatistics(batchId: string): Promise<BatchStatisticsView | undefined> {
    return BatchViewParser.statistics(
      await this.http.read("/batch/statistics", { batchId: RequestArguments.identifier(batchId) }),
    )
  }

  async historicBatch(batchId: string): Promise<HistoricBatchView> {
    return BatchViewParser.historic(
      await this.http.read(`/history/batch/${RequestArguments.segment(batchId)}`),
    )
  }

  async failedJobs(jobDefinitionId: string): Promise<FailedJobView[]> {
    return BatchViewParser.failedJobs(
      await this.http.read("/job", {
        jobDefinitionId: RequestArguments.identifier(jobDefinitionId),
        withException: "true",
        noRetriesLeft: "true",
        maxResults: String(MAX_FAILED_JOBS),
      }),
    )
  }

  async migrationPlan(
    sourceDefinitionId: string,
    targetDefinitionId: string,
  ): Promise<MigrationPlanView> {
    return MigrationViewParser.plan(
      await this.http.read(
        "/migration/generate",
        {},
        {
          sourceProcessDefinitionId: sourceDefinitionId,
          targetProcessDefinitionId: targetDefinitionId,
          updateEventTriggers: false,
        },
      ),
    )
  }

  async migrationReport(plan: MigrationPlanView): Promise<MigrationReportView> {
    const instructions = plan.instructions.map((instruction) => ({
      ...instruction,
      updateEventTrigger: false,
    }))
    return MigrationViewParser.report(
      await this.http.read("/migration/validate", {}, { ...plan, instructions }),
    )
  }

  private static pageOf(page: OffsetPage): Record<string, string> {
    return { firstResult: String(page.firstResult), maxResults: String(page.maxResults) }
  }
}
