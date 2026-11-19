/**
 * A history query by incident below history level FULL: the engine writes no incident to its
 * history there, so the query answers "none" for every instance. c7-core's `unrecordedIncidents`
 * tells that from a true "none" (the runtime holds open incidents the history does not), and such
 * an empty answer is refused, never returned as a count. Names no tool.
 */

import type { Client } from "@miragon/pulse-c7-client"
import { unrecordedIncidents } from "@miragon/pulse-c7-core"
import type { PaginatedList } from "../mcp/pagination.js"
import { enginePortFor } from "./engine-port.js"
import { WorkflowToolError } from "./workflow-errors.js"

/** The code of the refusal, which `withToolErrors` prints before the message. */
const INCIDENT_HISTORY_NOT_KEPT = "INCIDENT_HISTORY_NOT_KEPT"

function refusal(open: number): WorkflowToolError {
  const incidents = open === 1 ? "1 open incident" : `${open} open incidents`
  return new WorkflowToolError(
    INCIDENT_HISTORY_NOT_KEPT,
    `This engine's history holds none of its ${incidents}: it records incidents only at history ` +
      "level FULL, so a history query by incident finds nothing on it. The runtime's incident " +
      "list and its process instances with withIncidents show the open ones.",
  )
}

/** `list` when it holds a row or the history keeps the open incidents; else the refusal. */
export async function checkedIncidentHistory<T>(
  client: Client,
  list: PaginatedList<T>,
): Promise<PaginatedList<T>> {
  if (list.totalCount > 0) return list
  const unrecorded = await unrecordedIncidents(enginePortFor(client))
  if (unrecorded > 0) throw refusal(unrecorded)
  return list
}
