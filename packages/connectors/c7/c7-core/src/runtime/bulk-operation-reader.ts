/**
 * A bulk operation of the engine contract (`getBulkOperation`, `getBulkFailures`): a batch that
 * cancels or migrates instances, read from its statistics while the runtime holds it and from the
 * history once it left, counted in items (its jobs times the items each job holds, completed and
 * failed never above the total); the failures of a batch the runtime holds from its jobs that
 * failed with no retries left, each reason on one line and cut to 300 characters, with the
 * instance its message names. A batch of another type reads as none.
 */

import {
  BulkOperationId,
  InstanceId,
  type BulkFailure,
  type BulkOperation,
  type BulkOperationKind,
} from "@miragon/pulse-engine-core"
import type { EnginePort } from "../port.js"
import { compact } from "../util.js"
import {
  type BatchRow,
  type BatchStatisticsRow,
  type FailedJobRow,
  findHistoricBatch,
  type HistoricBatchRow,
  readBatchStatistics,
  readFailedJobs,
} from "./batches.js"
import { optionalTimestampOf } from "./timestamps.js"

type BulkBase = Omit<BulkOperation, "state"> & { readonly total: number }

/** The batch types a bulk operation of the contract starts. */
const KINDS: Readonly<Record<string, BulkOperationKind>> = {
  "instance-deletion": "cancelInstances",
  "instance-migration": "migrateInstances",
}
const MAX_REASON_LENGTH = 300
const NAMED_INSTANCE = /process instance '([^']+)'/i
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\s]+/gu

function baseOf(batch: BatchRow): BulkBase | undefined {
  const kind = KINDS[batch.type]
  if (kind === undefined) {
    return undefined
  }
  return {
    id: BulkOperationId(batch.id),
    kind,
    total: batch.totalJobs * batch.invocationsPerBatchJob,
    ...compact({ startedAt: optionalTimestampOf(batch.startTime) }),
  }
}

function runningOf(batch: BatchStatisticsRow): BulkOperation | undefined {
  const base = baseOf(batch)
  if (base === undefined) {
    return undefined
  }
  const items = (jobs: number): number => Math.min(jobs * batch.invocationsPerBatchJob, base.total)
  return {
    ...base,
    state: batch.suspended ? "suspended" : "running",
    completed: items(batch.completedJobs),
    failed: items(batch.failedJobs),
  }
}

function endedOf(batch: HistoricBatchRow): BulkOperation | undefined {
  const base = baseOf(batch)
  return base === undefined
    ? undefined
    : { ...base, state: "ended", ...compact({ endedAt: optionalTimestampOf(batch.endTime) }) }
}

function failureOf(job: FailedJobRow): BulkFailure {
  const message = job.exceptionMessage ?? `Job ${job.id} failed without a message.`
  const reason = message.replace(UNPRINTABLE, " ").trim()
  const named = NAMED_INSTANCE.exec(message)?.[1]
  return {
    reason:
      reason.length > MAX_REASON_LENGTH ? `${reason.slice(0, MAX_REASON_LENGTH - 1)}…` : reason,
    ...(named === undefined ? {} : { instanceId: InstanceId(named) }),
  }
}

/** Reads the bulk operations of an engine, its batches, over the engine's port. */
export class BulkOperationReader {
  constructor(private readonly port: EnginePort) {}

  /** The batch `bulkOperationId`; undefined when the engine knows none of a contract's kind. */
  async read(bulkOperationId: BulkOperationId): Promise<BulkOperation | undefined> {
    const running = await readBatchStatistics(this.port, bulkOperationId)
    if (running !== undefined) {
      return runningOf(running)
    }
    const ended = await findHistoricBatch(this.port, bulkOperationId)
    return ended === undefined ? undefined : endedOf(ended)
  }

  /** The failed items of the batch `bulkOperationId`; none once it left the runtime. */
  async failures(bulkOperationId: BulkOperationId): Promise<BulkFailure[]> {
    const running = await readBatchStatistics(this.port, bulkOperationId)
    if (running?.batchJobDefinitionId === undefined || running.failedJobs === 0) {
      return []
    }
    const jobs = await readFailedJobs(this.port, running.batchJobDefinitionId)
    return jobs.map((job) => failureOf(job))
  }
}
