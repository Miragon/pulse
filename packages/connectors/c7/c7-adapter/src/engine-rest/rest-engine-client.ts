import { createEnginePort, RAW_VARIABLES_QUERY, type EnginePort } from "@miragon/pulse-c7-core"
import {
  readHistoricInstances,
  type HistoricInstanceQuery,
  type HistoricInstanceRow,
  type OffsetWindow,
} from "@miragon/pulse-c7-core/runtime"
import type { EngineClient } from "./engine-client.js"
import type { EngineHttp } from "./http/engine-http.js"
import { HttpEngineTransport } from "./inspect/http-engine-transport.js"
import { InstanceInspection } from "./inspect/instance-inspection.js"
import { RequestArguments } from "./request-arguments.js"
import { ActivityInstanceViewParser } from "./views/activity-instance-view-parser.js"
import { BatchViewParser } from "./views/batch-view-parser.js"
import { MigrationViewParser } from "./views/migration-view-parser.js"
import { VariableViewParser } from "./views/variable-view-parser.js"
import type {
  ActivityInstanceView,
  BatchStatisticsView,
  FailedJobView,
  HistoricBatchView,
  InspectView,
  MigrationPlanView,
  MigrationReportView,
  VariableView,
} from "./views/views.js"

export const VARIABLE_PAGE_SIZE = 500
const MAX_FAILED_JOBS = 100

export class RestEngineClient implements EngineClient {
  readonly port: EnginePort

  constructor(private readonly http: EngineHttp) {
    this.port = createEnginePort(HttpEngineTransport.over(http))
  }

  historicInstances(
    query: HistoricInstanceQuery,
    page: OffsetWindow,
  ): Promise<HistoricInstanceRow[]> {
    return readHistoricInstances(this.port, query, page)
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
        ...RAW_VARIABLES_QUERY,
        maxResults: String(VARIABLE_PAGE_SIZE),
      }),
    )
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
}
