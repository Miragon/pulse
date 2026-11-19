/**
 * The engine's timestamps as the engine contract's (`IsoTimestamp` of @miragon/pulse-engine-core):
 * the engine writes its offset without a colon (`2026-10-21T18:44:04.587+0000`), which not every
 * date parser reads, so the colon goes in before the contract's ISO-8601 in UTC. Pure.
 */

import { IsoTimestamp } from "@miragon/pulse-engine-core"

/** An offset as the engine writes it: sign, hours and minutes, no colon. */
const COMPACT_OFFSET = /([+-]\d{2})(\d{2})$/

/** The contract's timestamp of an engine timestamp; one no date parser reads fails as a `RangeError`. */
export function timestampOf(value: string): IsoTimestamp {
  return IsoTimestamp(value.replace(COMPACT_OFFSET, "$1:$2"))
}

/** As {@link timestampOf}, undefined for a timestamp the engine did not name. */
export function optionalTimestampOf(value: string | undefined): IsoTimestamp | undefined {
  return value === undefined ? undefined : timestampOf(value)
}
