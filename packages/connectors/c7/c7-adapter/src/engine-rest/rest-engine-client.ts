import { createEnginePort, type EnginePort } from "@miragon/pulse-c7-core"
import {
  type BatchStatisticsRow,
  findHistoricBatch,
  type HistoricBatchRow,
  type HistoricInstanceQuery,
  type HistoricInstanceRow,
  type OffsetWindow,
  readBatchStatistics,
  readHistoricInstances,
} from "@miragon/pulse-c7-core/runtime"
import type { EngineClient } from "./engine-client.js"
import type { EngineHttp } from "./http/engine-http.js"
import { HttpEngineTransport } from "./inspect/http-engine-transport.js"
import { RequestArguments } from "./request-arguments.js"
import { ActivityInstanceViewParser } from "./views/activity-instance-view-parser.js"
import type { ActivityInstanceView } from "./views/views.js"

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

  async activityInstances(instanceId: string): Promise<ActivityInstanceView> {
    return ActivityInstanceViewParser.tree(
      await this.http.read(
        `/process-instance/${RequestArguments.segment(instanceId)}/activity-instances`,
      ),
    )
  }

  async batchStatistics(batchId: string): Promise<BatchStatisticsRow | undefined> {
    return await readBatchStatistics(this.port, RequestArguments.identifier(batchId))
  }

  async historicBatch(batchId: string): Promise<HistoricBatchRow | undefined> {
    return await findHistoricBatch(this.port, RequestArguments.identifier(batchId))
  }
}
