/**
 * The floor under the web app's screen reads that load an engine's database (plan 3.2): the engine
 * screen's processes with their counts (Camunda 7's definition statistics, a Camunda 8 cluster's
 * incident search per process in trouble), a process screen's element statistics, the first page of
 * an instance list (its history counts and its search; a later page's cursor belongs to the first
 * page read before it, so it is read each time), a version's variable names, a search. A caller's read of the same feed with the same arguments within 30 s gets the
 * answer read before, its `asOf` that read's, so a Refresh within the floor reads nothing again and
 * a page's many readers cost the engine one read. It keeps per configured engine and per CALLER
 * (`createOwnerCache` over `callerCacheKey`: a renewed token reads anew, under passthrough auth the
 * engine decides per token what a caller may read), as a board's build does; a failed read is not
 * kept, and neither is an answer `keep` refuses (one an enrichment is missing from).
 */

import { createOwnerCache, runtimeEngineKey } from "../../lib/engine/per-engine.js"
import type { RuntimeEngine } from "../../lib/engine/resolve-engine.js"

/** How long a screen's read answers again for the same caller and arguments. */
export const SCREEN_FLOOR_MS = 30_000

/** Answers of one feed per engine and caller at most; past it the caller's least recently used one goes. */
const SCREEN_FLOOR_ENTRIES = 8

/**
 * Callers kept per engine and feed; past it the least recently active caller's answers go. A feed
 * keeps SCREEN_FLOOR_CALLERS × SCREEN_FLOOR_ENTRIES (256) answers per engine at most, as many as
 * it kept for every caller together before each caller had a bound of its own.
 */
const SCREEN_FLOOR_CALLERS = 32

/** A floor of one feed: the answer of `read` for `args` on `engine`, kept for SCREEN_FLOOR_MS. */
export type ScreenFloor<T> = (
  engine: RuntimeEngine,
  args: object,
  read: () => Promise<T>,
) => Promise<T>

/** A floor for one feed's answers, `keep` deciding which answers stay for the floor. */
export function screenFloor<T>(keep: (value: T) => boolean = () => true): ScreenFloor<T> {
  const cached = createOwnerCache<T>({
    maxEntries: SCREEN_FLOOR_ENTRIES,
    maxCallers: SCREEN_FLOOR_CALLERS,
    ttlMs: SCREEN_FLOOR_MS,
    now: () => Date.now(),
    keep,
  })
  return (engine, args, read) => cached(runtimeEngineKey(engine), JSON.stringify(args), read)
}
