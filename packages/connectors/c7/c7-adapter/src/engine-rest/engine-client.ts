import type { EnginePort } from "@miragon/pulse-c7-core"
import type {
  BatchStatisticsRow,
  HistoricBatchRow,
  HistoricInstanceQuery,
  HistoricInstanceRow,
  OffsetWindow,
} from "@miragon/pulse-c7-core/runtime"
import type { ActivityInstanceView } from "./views/views.js"

export interface EngineClient {
  readonly port: EnginePort
  historicInstances(
    query: HistoricInstanceQuery,
    page: OffsetWindow,
  ): Promise<HistoricInstanceRow[]>
  activityInstances(instanceId: string): Promise<ActivityInstanceView>
  batchStatistics(batchId: string): Promise<BatchStatisticsRow | undefined>
  historicBatch(batchId: string): Promise<HistoricBatchRow | undefined>
}
