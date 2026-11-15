/**
 * The batches of an engine as a bulk operation of the engine contract reads them: the statistics
 * of a batch the runtime still holds, the history of one that left it and the failed jobs of a
 * batch's job definition, each read through `JsonView`. Every read checks its id by the one id
 * rule, so an id no engine assigns fails as `RuntimeError("misconfigured")` before a request
 * leaves.
 */

import type { EnginePort } from "../port.js"
import { queryInput } from "../requests.js"
import { compact } from "../util.js"
import { engineIdOf } from "./engine-ids.js"
import { findUnlessGone } from "./find-unless-gone.js"
import { JsonView } from "./json-view.js"

/** What the runtime and the history say of every batch. */
export interface BatchRow {
  readonly id: string
  readonly type: string
  readonly totalJobs: number
  readonly invocationsPerBatchJob: number
  readonly batchJobDefinitionId?: string
  readonly startTime?: string
}

/** A batch the runtime holds, with its jobs done and failed. */
export interface BatchStatisticsRow extends BatchRow {
  readonly suspended: boolean
  readonly completedJobs: number
  readonly failedJobs: number
}

/** A batch of the history, with its end once it ended. */
export interface HistoricBatchRow extends BatchRow {
  readonly endTime?: string
}

/** A job of a batch that failed with no retries left. */
export interface FailedJobRow {
  readonly id: string
  readonly exceptionMessage?: string
}

/** The failed jobs of a batch read at most. */
const MAX_FAILED_JOBS = 100

function batchOf(record: JsonView): BatchRow {
  return {
    id: record.requiredString("id"),
    type: record.requiredString("type"),
    totalJobs: record.requiredNumber("totalJobs"),
    invocationsPerBatchJob: record.optionalNumber("invocationsPerBatchJob") ?? 1,
    ...compact({
      batchJobDefinitionId: record.optionalString("batchJobDefinitionId"),
      startTime: record.optionalString("startTime"),
    }),
  }
}

function historicBatchOf(answer: unknown): HistoricBatchRow {
  const record = JsonView.of(answer, "historic batch")
  return { ...batchOf(record), ...compact({ endTime: record.optionalString("endTime") }) }
}

/** The statistics of the batch `batchId` while the runtime holds it; undefined once it left. */
export async function readBatchStatistics(
  port: EnginePort,
  batchId: string,
): Promise<BatchStatisticsRow | undefined> {
  const answer = await port.json("getBatchStatistics", queryInput({ batchId: engineIdOf(batchId) }))
  const [first] = JsonView.listOf(answer, "batch statistics")
  if (first === undefined) {
    return undefined
  }
  return {
    ...batchOf(first),
    suspended: first.value("suspended") === true,
    completedJobs: first.requiredNumber("completedJobs"),
    failedJobs: first.requiredNumber("failedJobs"),
  }
}

/** The history of the batch `batchId`; undefined when the engine does not know it. */
export async function findHistoricBatch(
  port: EnginePort,
  batchId: string,
): Promise<HistoricBatchRow | undefined> {
  const input = { pathArgs: [engineIdOf(batchId)], query: {} }
  return await findUnlessGone(port, "getHistoricBatch", input, historicBatchOf)
}

/** The jobs of the batch job definition `jobDefinitionId` that failed with no retries left. */
export async function readFailedJobs(
  port: EnginePort,
  jobDefinitionId: string,
): Promise<FailedJobRow[]> {
  const answer = await port.json(
    "getJobs",
    queryInput({
      jobDefinitionId: engineIdOf(jobDefinitionId),
      withException: "true",
      noRetriesLeft: "true",
      maxResults: String(MAX_FAILED_JOBS),
    }),
  )
  return JsonView.listOf(answer, "failed jobs").map((job) => ({
    id: job.requiredString("id"),
    ...compact({ exceptionMessage: job.optionalString("exceptionMessage") }),
  }))
}
