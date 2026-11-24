import type { Client } from "@miragon/pulse-c7-client"
import { getHistoricProcessInstances, getProcessInstances } from "@miragon/pulse-c7-client/sdk"
import { optional, rowsOf } from "./engine-reads.js"

/**
 * Whether the engine writes history at all, asked where a read of the history found nothing: an
 * instance runs but none is open in the history (history level `none`). Both reads are
 * enrichment, one row each; null where nothing tells (no instance runs) or a read failed.
 */
export async function recordsHistory(client: Client): Promise<boolean | null> {
  const [running, open] = await Promise.all([
    optional(getProcessInstances({ client, query: { maxResults: 1 } }).then(rowsOf)),
    optional(
      getHistoricProcessInstances({ client, query: { unfinished: true, maxResults: 1 } }).then(
        rowsOf,
      ),
    ),
  ])
  if (running === null || open === null) return null
  if (open.length > 0) return true
  return running.length > 0 ? false : null
}
