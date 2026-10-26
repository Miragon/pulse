import type { BulkFailure, BulkOperation, BulkOperationId } from "../../../contract/index.js"
import type { EngineClient } from "../engine-cli/index.js"
import { ErrorTranslation } from "../errors/error-translation.js"
import type { BulkFailureMapper } from "../mapping/bulk-failure-mapper.js"
import type { BulkOperationMapper } from "../mapping/bulk-operation-mapper.js"

export interface BulkMappers {
  readonly operations: BulkOperationMapper
  readonly failures: BulkFailureMapper
}

export class BulkOperationReader {
  constructor(
    private readonly client: EngineClient,
    private readonly mappers: BulkMappers,
  ) {}

  async read(bulkOperationId: BulkOperationId): Promise<BulkOperation | undefined> {
    const running = await this.client.batchStatistics(bulkOperationId)
    if (running !== undefined) {
      return this.mappers.operations.running(running)
    }
    const ended = await ErrorTranslation.unlessMissing(() =>
      this.client.historicBatch(bulkOperationId),
    )
    return ended === undefined ? undefined : this.mappers.operations.ended(ended)
  }

  async failures(bulkOperationId: BulkOperationId): Promise<readonly BulkFailure[]> {
    const running = await this.client.batchStatistics(bulkOperationId)
    if (running?.batchJobDefinitionId === undefined || running.failedJobs === 0) {
      return []
    }
    const jobs = await this.client.failedJobs(running.batchJobDefinitionId)
    return jobs.map((job) => this.mappers.failures.map(job))
  }
}
