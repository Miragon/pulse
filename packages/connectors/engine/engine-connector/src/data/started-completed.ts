import type { Client } from "@miragon/pulse-c7-client"
import { toEngineDate } from "@miragon/pulse-c7-core"
import { getHistoricProcessInstancesCount } from "@miragon/pulse-c7-client/sdk"
import { countOf, optional } from "./engine-reads.js"
import { recordsHistory } from "./history-recorded.js"

/** The instances the history counts as started and as completed in a window. */
export interface StartedAndCompleted {
  /** Instances started in the window; null when unread or the engine writes no history. */
  started: number | null
  /** Instances completed in the window; null when unread or the engine writes no history. */
  completed: number | null
  /** False: the engine writes no history; null: unknown. Asked only when no count is above 0. */
  historyRecorded: boolean | null
}

function countHistoric(
  client: Client,
  query: { startedAfter: string } | { finishedAfter: string },
): Promise<number | null> {
  return optional(getHistoricProcessInstancesCount({ client, query }).then(countOf))
}

/**
 * A count above 0 proves a written history. Otherwise a 0, even beside a failed count, asks whether
 * the engine writes one at all; two failed counts leave nothing to ask about.
 */
async function historyRecordedBy(
  client: Client,
  started: number | null,
  completed: number | null,
): Promise<boolean | null> {
  if ((started ?? 0) > 0 || (completed ?? 0) > 0) return true
  return started === 0 || completed === 0 ? recordsHistory(client) : null
}

/**
 * The instances started and completed since `sinceMs`, from the history. Every read is enrichment,
 * since an engine at history level `none` is a healthy one. Its history counts 0 while instances
 * run, so a 0 with no count above it asks whether the engine writes history at all
 * (`recordsHistory`); where it writes none, both counts are unknown, never 0.
 */
export async function readStartedAndCompleted(
  client: Client,
  sinceMs: number,
): Promise<StartedAndCompleted> {
  // History filters take the engine's date format (REST contract).
  const since = toEngineDate(new Date(sinceMs))
  const [started, completed] = await Promise.all([
    countHistoric(client, { startedAfter: since }),
    countHistoric(client, { finishedAfter: since }),
  ])
  const historyRecorded = await historyRecordedBy(client, started, completed)
  if (historyRecorded === false) return { started: null, completed: null, historyRecorded }
  return { started, completed, historyRecorded }
}
