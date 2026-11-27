/**
 * The batches of the status triage, read in round 1 beside the rest: how many batches run and how
 * many of them hold failed jobs, each an exact count (`/batch/statistics/count`), and the batches
 * with failed jobs themselves, the first 100 (`/batch/statistics` with `withFailures=true`): the
 * BATCH_FAILURES findings name them, and their job definitions keep a batch's failed jobs out of
 * the incident groups. A count answer it cannot read fails as the reason `unexpected-answer`,
 * never as 0. Where the page is full and the engine counts more batches with failed jobs, the cut
 * is named. Engine-wide only: a batch belongs to no process definition, so a key filter reads
 * none.
 */

import { readable } from "./errors.js"
import { JsonView } from "./json-view.js"
import type { EnginePort, PlannedRequest } from "./port.js"
import { type Rec, records } from "./records.js"
import { queryInput } from "./requests.js"

/** Batches with failed jobs loaded at most. */
const FAILED_BATCHES = 100

const WITH_FAILURES = { withFailures: "true" }

/** The batch requests of round 1, as a preview lists them: the page, then the two counts. */
export const BATCH_REQUESTS: readonly PlannedRequest[] = [
  {
    operationId: "getBatchStatistics",
    input: queryInput({ maxResults: String(FAILED_BATCHES), ...WITH_FAILURES }),
  },
  { operationId: "getBatchStatisticsCount", input: queryInput({}) },
  { operationId: "getBatchStatisticsCount", input: queryInput(WITH_FAILURES) },
]

/** The batches of the status. */
export interface StatusBatches {
  /** The batches with failed jobs, the first `FAILED_BATCHES` the engine lists. */
  readonly failed: readonly Rec[]
  /** Every running batch, counted. */
  readonly running: number
  /** The running batches with failed jobs, counted. */
  readonly withFailures: number
}

/** The `count` of a `getBatchStatisticsCount` answer, which the answer must hold. */
function countIn(answer: unknown): Promise<number> {
  return readable("getBatchStatisticsCount", () =>
    JsonView.of(answer, "batch statistics count").requiredNumber("count"),
  )
}

/** The batches over `port`, in the requests `BATCH_REQUESTS` names. */
export async function readBatches(port: EnginePort): Promise<StatusBatches> {
  const [failed, running, withFailures] = await Promise.all(
    BATCH_REQUESTS.map((planned) => port.json(planned.operationId, planned.input)),
  )
  return {
    failed: records(failed),
    running: await countIn(running),
    withFailures: await countIn(withFailures),
  }
}

/**
 * The cut of the batches with failed jobs: the page is full and the engine counts more. A page
 * that is not full held every such batch when it was read, whatever the count read beside it says
 * (a batch job that ran out of retries between the two).
 */
export function batchesCut(batches: StatusBatches | undefined): string | undefined {
  if (batches === undefined) return undefined
  const { failed, withFailures } = batches
  if (failed.length < FAILED_BATCHES || withFailures <= failed.length) return undefined
  return `batches with failures: ${failed.length} of ${withFailures} loaded`
}
