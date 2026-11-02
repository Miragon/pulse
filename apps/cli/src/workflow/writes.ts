/**
 * engine-core's writes as the workflow commands print them: its label is the summary that
 * `--dry-run` and the `Done:` lines show. Pure.
 */

import type * as core from "@miragon/pulse-engine-core"
import type { PlannedWrite } from "./types.js"

/** A write of engine-core with its label as the summary. */
export function plannedWrite(write: core.PlannedWrite): PlannedWrite {
  return { summary: write.label, operationId: write.operationId, input: write.input }
}
