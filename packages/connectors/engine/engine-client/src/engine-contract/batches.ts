/**
 * Batches. A batch write (`POST /job/retries`, `POST /migration/executeAsync`)
 * returns as soon as the engine has QUEUED the batch — the work and its
 * failures happen later, in batch jobs. A tool must therefore never report
 * the queued batch as done: it hands back the batch id with status `queued`,
 * and `engine_get_batch` reports what became of it.
 */
import type { BatchDto, BatchStatisticsDto, HistoricBatchDto } from "../generated/types.gen.js"

/** What a batch write returns: the id to follow up on, never a success flag. */
export interface QueuedBatch {
  batchId: string
  status: "queued"
  /** Engine batch type, e.g. `set-job-retries`, `instance-migration`. */
  type: string | null
  totalJobs: number | null
}

export function queuedBatch(batch: BatchDto): QueuedBatch {
  return {
    batchId: batch.id ?? "",
    status: "queued",
    type: batch.type ?? null,
    totalJobs: batch.totalJobs ?? null,
  }
}

/**
 * - `running` — batch jobs are still being created or executed;
 * - `failing` — some batch jobs ran out of retries: the batch cannot finish
 *   until they are retried or the batch is deleted;
 * - `suspended` — suspended, nothing executes;
 * - `completed` — the batch ended (all jobs done, or it was deleted).
 */
export type BatchStatus = "running" | "failing" | "suspended" | "completed"

export interface BatchReport {
  batchId: string
  type: string | null
  status: BatchStatus
  totalJobs: number | null
  /** Runtime counts — null once the batch has ended. */
  remainingJobs: number | null
  completedJobs: number | null
  failedJobs: number | null
  startTime: string | null
  endTime: string | null
}

export function runningBatchReport(stats: BatchStatisticsDto): BatchReport {
  const failedJobs = stats.failedJobs ?? 0
  const status: BatchStatus = stats.suspended ? "suspended" : failedJobs > 0 ? "failing" : "running"
  return {
    batchId: stats.id ?? "",
    type: stats.type ?? null,
    status,
    totalJobs: stats.totalJobs ?? null,
    remainingJobs: stats.remainingJobs ?? null,
    completedJobs: stats.completedJobs ?? null,
    failedJobs,
    startTime: stats.startTime ?? null,
    endTime: null,
  }
}

/** A batch the runtime no longer holds, from its history record. */
export function endedBatchReport(batch: HistoricBatchDto): BatchReport {
  return {
    batchId: batch.id ?? "",
    type: batch.type ?? null,
    // A historic batch without endTime is one the runtime query just missed.
    status: batch.endTime ? "completed" : "running",
    totalJobs: batch.totalJobs ?? null,
    remainingJobs: null,
    completedJobs: null,
    failedJobs: null,
    startTime: batch.startTime ?? null,
    endTime: batch.endTime ?? null,
  }
}
