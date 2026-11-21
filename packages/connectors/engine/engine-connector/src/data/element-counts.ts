import type { Client } from "@miragon/pulse-c7-client"
import { mapLimit } from "@miragon/pulse-c7-core"
import type { ElementStatisticsWithFailedJobs } from "@miragon/pulse-c7-core/runtime"
import { DefinitionId } from "@miragon/pulse-engine-core"
import { c7RuntimeOf } from "../lib/engine/engine-runtime.js"
import { createCallerCache } from "../lib/engine/per-engine.js"
import { MULTI_INSTANCE_BODY } from "./activity-diagram.js"
import { SCREEN_FLOOR_MS } from "./screens/screen-floor.js"

/**
 * Versions read at once: a key with many versions never fans out in one burst. Each version's read
 * sends its statistics, then where an element holds an incident its diagram (through the one XML
 * cache, so once per caller) and the pages of its call activities' incidents, one after the other,
 * so this many versions' requests are in flight, the call activities' up to 8 each.
 */
const VERSION_READS_AT_ONCE = 4

/** A version's counts kept per engine and caller at most; past it the least recently used one goes. */
const VERSION_FLOOR_ENTRIES = 256

/**
 * The floor under a version's element counts: they read the statistics with every incident and the
 * incidents at the version's call activities whole, which loads the engine's database as the shared
 * process screen's read does (plan 3.2), so a caller's read of the same version within
 * SCREEN_FLOOR_MS (30 s) gets the counts read before, whichever view asked ("Running" or the
 * process route), and a Refresh within it reads nothing again. Kept per engine
 * client and per CALLER (`createCallerCache`: a renewed token reads anew); a failed read is not kept.
 */
const versionFloor = createCallerCache<readonly ElementStatisticsWithFailedJobs[]>({
  maxEntries: VERSION_FLOOR_ENTRIES,
  ttlMs: SCREEN_FLOOR_MS,
  now: () => Date.now(),
})

/** What one element of a key holds now, summed over the versions read. */
export interface ElementCounts {
  /** Tokens at the element, without those a root incident raised there holds. */
  active: number
  /** Open root incidents raised at the element. */
  incidents: number
  /** Open incidents of the instances the element called: copies, never part of the incident count. */
  incidentsInCalledInstances: number
  /** Jobs at the element whose retries are used up. */
  failedJobs: number
}

/**
 * The counts on the diagrams of `versionIds`, summed per element (a multi-instance body on its
 * element), by the rule the shared process screen reads them with: each version's element
 * statistics (c7-core's `ElementStatisticsReader` over the server's wire, with each element's jobs
 * without retries and every incident at an element from the same one statistics read), whose
 * incidents are root incidents wherever no copy can lie, and which reads the incidents at the
 * version's call activities whole to tell the root incidents raised there from the copies a call
 * activity holds of its called instances' (`isRootIncident`), the named exception to "never a scan"
 * (invariant 7), since the read is whole and never a capped page. At most
 * {@link VERSION_READS_AT_ONCE} versions at once, each on the floor of 30 s per caller
 * (`versionFloor`). Every version's read is primary: one left out would undercount the key.
 */
export async function readElementCounts(
  client: Client,
  versionIds: readonly string[],
): Promise<Map<string, ElementCounts>> {
  const runtime = c7RuntimeOf(client)
  const perVersion = await mapLimit(versionIds, VERSION_READS_AT_ONCE, (id) =>
    versionFloor(client, id, () => runtime.getElementStatisticsWithFailedJobs(DefinitionId(id))),
  )
  const byElement = new Map<string, ElementCounts>()
  for (const element of perVersion.flat()) {
    const id = element.elementId.replace(MULTI_INSTANCE_BODY, "")
    const counts = byElement.get(id) ?? {
      active: 0,
      incidents: 0,
      incidentsInCalledInstances: 0,
      failedJobs: 0,
    }
    counts.active += element.active
    counts.incidents += element.incidents
    counts.incidentsInCalledInstances += element.incidentsInCalledInstances
    counts.failedJobs += element.failedJobs
    byElement.set(id, counts)
  }
  return byElement
}
