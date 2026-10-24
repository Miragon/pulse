import { ReadCommands } from "./commands/read-commands.js"
import type { EngineClient, EngineClientOptions } from "./engine-client.js"
import { EngineCliRunner } from "./running/engine-cli-runner.js"
import { ActivityInstanceViewParser } from "./views/activity-instance-view-parser.js"
import { BatchViewParser } from "./views/batch-view-parser.js"
import { DefinitionViewParser } from "./views/definition-view-parser.js"
import { EngineViewParser } from "./views/engine-view-parser.js"
import { HistoricInstanceViewParser } from "./views/historic-instance-view-parser.js"
import { IncidentViewParser } from "./views/incident-view-parser.js"
import { InspectViewParser } from "./views/inspect-view-parser.js"
import { MigrationViewParser } from "./views/migration-view-parser.js"
import { VariableViewParser } from "./views/variable-view-parser.js"
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

export class EngineCliClient implements EngineClient {
  constructor(private readonly runner: EngineCliRunner) {}

  static create(options: EngineClientOptions): EngineCliClient {
    return new EngineCliClient(EngineCliRunner.create(options))
  }

  async product(): Promise<ProductView> {
    return EngineViewParser.product(await this.runner.json(ReadCommands.product()))
  }

  async version(): Promise<string> {
    return EngineViewParser.version(await this.runner.json(ReadCommands.version()))
  }

  async definitionStatistics(): Promise<DefinitionStatisticsView[]> {
    return DefinitionViewParser.definitionStatistics(
      await this.runner.json(ReadCommands.definitionStatistics()),
    )
  }

  async activityStatistics(definitionId: string): Promise<ActivityStatisticsView[]> {
    return DefinitionViewParser.activityStatistics(
      await this.runner.json(ReadCommands.activityStatistics(definitionId)),
    )
  }

  async diagramXml(definitionId: string): Promise<string> {
    return DefinitionViewParser.diagramXml(
      await this.runner.json(ReadCommands.diagramXml(definitionId)),
    )
  }

  async incidents(query: IncidentQuery, page?: OffsetPage): Promise<IncidentView[]> {
    return IncidentViewParser.incidents(await this.runner.json(ReadCommands.incidents(query, page)))
  }

  async incidentInstances(): Promise<IncidentInstanceView[]> {
    return IncidentViewParser.incidentInstances(
      await this.runner.json(ReadCommands.incidentInstances()),
    )
  }

  async incident(incidentId: string): Promise<IncidentView> {
    return IncidentViewParser.incident(await this.runner.json(ReadCommands.incident(incidentId)))
  }

  async historicInstances(
    query: HistoricInstanceQuery,
    page: OffsetPage,
  ): Promise<HistoricInstanceView[]> {
    return HistoricInstanceViewParser.instances(
      await this.runner.json(
        ReadCommands.historicInstances(page),
        ReadCommands.historicInstanceBody(query),
      ),
    )
  }

  async historicInstanceCount(query: HistoricInstanceQuery): Promise<number> {
    return HistoricInstanceViewParser.count(
      await this.runner.json(
        ReadCommands.historicInstanceCount(),
        ReadCommands.historicInstanceCountBody(query),
      ),
    )
  }

  async inspect(instanceId: string): Promise<InspectView> {
    return InspectViewParser.view(await this.runner.json(ReadCommands.inspect(instanceId)))
  }

  async activityInstances(instanceId: string): Promise<ActivityInstanceView> {
    return ActivityInstanceViewParser.tree(
      await this.runner.json(ReadCommands.activityInstances(instanceId)),
    )
  }

  async variables(instanceId: string): Promise<VariableView[]> {
    return VariableViewParser.instances(await this.runner.json(ReadCommands.variables(instanceId)))
  }

  async jobStacktrace(jobId: string): Promise<string> {
    return this.runner.text(ReadCommands.jobStacktrace(jobId))
  }

  async externalTaskErrorDetails(externalTaskId: string): Promise<string> {
    return this.runner.text(ReadCommands.externalTaskErrorDetails(externalTaskId))
  }

  async batchStatistics(batchId: string): Promise<BatchStatisticsView | undefined> {
    return BatchViewParser.statistics(await this.runner.json(ReadCommands.batchStatistics(batchId)))
  }

  async historicBatch(batchId: string): Promise<HistoricBatchView> {
    return BatchViewParser.historic(await this.runner.json(ReadCommands.historicBatch(batchId)))
  }

  async failedJobs(jobDefinitionId: string): Promise<FailedJobView[]> {
    return BatchViewParser.failedJobs(
      await this.runner.json(ReadCommands.failedJobs(jobDefinitionId)),
    )
  }

  async migrationPlan(
    sourceDefinitionId: string,
    targetDefinitionId: string,
  ): Promise<MigrationPlanView> {
    return MigrationViewParser.plan(
      await this.runner.json(
        ReadCommands.migrationPlan(),
        ReadCommands.migrationPlanBody(sourceDefinitionId, targetDefinitionId),
      ),
    )
  }

  async migrationReport(plan: MigrationPlanView): Promise<MigrationReportView> {
    return MigrationViewParser.report(
      await this.runner.json(
        ReadCommands.migrationReport(),
        ReadCommands.migrationReportBody(plan),
      ),
    )
  }
}
