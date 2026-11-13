/**
 * Planning of `pulse retry`: @miragon/pulse-c7-core's retry plan with usage errors that
 * name the flags and the skipped incidents' next commands.
 */

import * as core from "@miragon/pulse-c7-core"
import type { Effect } from "../catalog/types.js"
import { rendered } from "./error-text.js"
import { skipCommand } from "./next-text.js"
import type { Selection } from "./select.js"
import type { PlannedWrite } from "./types.js"
import { plannedWrite } from "./writes.js"

/** The selection mode: exactly one of instance, incidents and definition. */
export function retryMode(selection: Selection, incidentIds: readonly string[]): core.RetryMode {
  return rendered(() => core.retryMode(selection, incidentIds))
}

/** Retrying every incident of a definition is a bulk operation (`--yes`). */
export function retryEffect(mode: core.RetryMode): Effect {
  return core.retryEffect(mode)
}

/** Too many incidents to retry one by one: a usage error before any write. */
export function checkRetryCount(
  entries: readonly core.PlanEntry[],
  truncated: boolean,
  key: string | undefined,
): void {
  rendered(() => {
    core.checkRetryCount(entries, truncated, key)
  })
}

/** The retries request of an entry; undefined for skipped ones. */
export function retriesWrite(entry: core.PlanEntry, retries: number): PlannedWrite | undefined {
  const write = core.retriesWrite(entry, retries)
  return write === undefined ? undefined : plannedWrite(write)
}

/** The execute request of `--now` for a job entry. */
export function executeWrite(entry: core.PlanEntry): PlannedWrite | undefined {
  const write = core.executeWrite(entry)
  return write === undefined ? undefined : plannedWrite(write)
}

/** What to do about an incident retry cannot fix. */
export function skipNext(entry: core.PlanEntry): string {
  return skipCommand({ action: "resolveIncident", incidentId: entry.incidentId })
}

/** The `--dry-run` plan: counts per kind and the skipped incidents with their next command. */
export function retryPlanView(mode: core.RetryMode, entries: readonly core.PlanEntry[]) {
  const plan = core.retryPlanView(mode, entries)
  return {
    ...plan,
    skipped: plan.skipped.map((skip) => ({ ...skip, next: skipCommand(skip.next) })),
  }
}
