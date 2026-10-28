import {
  BulkOperationId,
  InstanceId,
  type BulkFailure,
  type BulkOperation,
  type BulkOperationKind,
} from "../../../contract/index.js"
import {
  Present,
  type BatchStatisticsView,
  type BatchView,
  type EngineClient,
  type FailedJobView,
  type HistoricBatchView,
} from "../engine-rest/index.js"
import { ErrorTranslation } from "../errors/error-translation.js"
import { Timestamps } from "../mapping/timestamps.js"

const KINDS: Readonly<Record<string, BulkOperationKind>> = {
  "instance-deletion": "cancelInstances",
  "instance-migration": "migrateInstances",
}
const MAX_REASON_LENGTH = 300
const NAMED_INSTANCE = /process instance '([^']+)'/i
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\s]+/gu

export class BulkOperationReader {
  constructor(private readonly client: EngineClient) {}

  async read(bulkOperationId: BulkOperationId): Promise<BulkOperation | undefined> {
    const running = await this.client.batchStatistics(bulkOperationId)
    if (running !== undefined) {
      return this.runningOf(running)
    }
    const ended = await ErrorTranslation.unlessMissing(() =>
      this.client.historicBatch(bulkOperationId),
    )
    return ended === undefined ? undefined : this.endedOf(ended)
  }

  async failures(bulkOperationId: BulkOperationId): Promise<readonly BulkFailure[]> {
    const running = await this.client.batchStatistics(bulkOperationId)
    if (running?.batchJobDefinitionId === undefined || running.failedJobs === 0) {
      return []
    }
    const jobs = await this.client.failedJobs(running.batchJobDefinitionId)
    return jobs.map((job) => this.failureOf(job))
  }

  private runningOf(batch: BatchStatisticsView): BulkOperation | undefined {
    const base = this.baseOf(batch)
    if (base === undefined) {
      return undefined
    }
    const items = (jobs: number): number =>
      Math.min(jobs * batch.invocationsPerBatchJob, base.total)
    return {
      ...base,
      state: batch.suspended ? "suspended" : "running",
      completed: items(batch.completedJobs),
      failed: items(batch.failedJobs),
    }
  }

  private endedOf(batch: HistoricBatchView): BulkOperation | undefined {
    const base = this.baseOf(batch)
    return base === undefined
      ? undefined
      : {
          ...base,
          state: "ended",
          ...Present.fields({ endedAt: Timestamps.optional(batch.endTime) }),
        }
  }

  private baseOf(batch: BatchView): (Omit<BulkOperation, "state"> & { total: number }) | undefined {
    const kind = KINDS[batch.type]
    if (kind === undefined) {
      return undefined
    }
    return {
      id: BulkOperationId(batch.id),
      kind,
      total: batch.totalJobs * batch.invocationsPerBatchJob,
      ...Present.fields({ startedAt: Timestamps.optional(batch.startTime) }),
    }
  }

  private failureOf(job: FailedJobView): BulkFailure {
    const message = job.exceptionMessage ?? `Job ${job.id} failed without a message.`
    const reason = message.replace(UNPRINTABLE, " ").trim()
    const named = NAMED_INSTANCE.exec(message)?.[1]
    return {
      reason:
        reason.length > MAX_REASON_LENGTH ? `${reason.slice(0, MAX_REASON_LENGTH - 1)}…` : reason,
      ...(named === undefined ? {} : { instanceId: InstanceId(named) }),
    }
  }
}
