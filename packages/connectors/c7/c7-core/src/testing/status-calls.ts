/** The requests of the status world's seed beyond the conformance world's, and its polls. */

import type { C7SeedEngine } from "./c7-world.js"
import { engineCall, jsonRequest, sent } from "./seed-calls.js"

const SETTLES_WITHIN_MS = 120_000
const POLL_INTERVAL_MS = 1_000

/**
 * Polls `GET <path>` until `done` holds of its JSON answer, waiting a second between two polls;
 * fails naming `what` once the waits passed two minutes.
 */
export async function pollUntil(
  engine: C7SeedEngine,
  path: string,
  done: (answer: unknown) => boolean,
  what: string,
): Promise<void> {
  let waited = 0
  while (!done(await engineCall<unknown>(engine, path))) {
    if (waited > SETTLES_WITHIN_MS) {
      throw new Error(`the status world has no ${what} after ${SETTLES_WITHIN_MS} ms`)
    }
    await engine.wait(POLL_INTERVAL_MS)
    waited += POLL_INTERVAL_MS
  }
}

/** Whether a count answer (`{ count }`) counts `expected`. */
export function counts(expected: number): (answer: unknown) => boolean {
  return (answer) => (answer as { readonly count?: unknown }).count === expected
}

/**
 * Starts a batch that sets the retries of `jobId`, a job no engine holds, so its own job fails
 * until its retries are used up: an incident without element, instance or version. Answers the
 * batch's id.
 */
export async function startFailingBatch(engine: C7SeedEngine, jobId: string): Promise<string> {
  const batch = await engineCall<{ readonly id: string }>(
    engine,
    "/job/retries",
    jsonRequest("POST", { jobIds: [jobId], retries: 1 }),
  )
  return batch.id
}

/**
 * Suspends the batch `batchId`: its failed job keeps its incident, and its monitor job, which the
 * engine would run every 30 s, is no executable job, so the jobs the status counts hold still.
 */
export async function suspendBatch(engine: C7SeedEngine, batchId: string): Promise<void> {
  await sent(engine, `/batch/${batchId}/suspended`, jsonRequest("PUT", { suspended: true }))
}
