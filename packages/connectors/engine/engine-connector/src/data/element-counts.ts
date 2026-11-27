import type { Client } from "@miragon/pulse-c7-client"
import { mapLimit } from "@miragon/pulse-c7-core"
import type { ElementStatisticsWithFailedJobs } from "@miragon/pulse-c7-core/runtime"
import { DefinitionId } from "@miragon/pulse-engine-core"
import { c7RuntimeOf } from "../lib/engine/engine-runtime.js"
import { createCallerCache, createOwnerCache } from "../lib/engine/per-engine.js"
import { definitionKeyInId, foldStatsByKey } from "./definition-info.js"
import { SCREEN_FLOOR_MS } from "./screens/screen-floor.js"
import { peekStatistics, readStatistics, type StatisticsRead } from "./statistics-floor.js"

/**
 * Versions read at once: a key with many versions never fans out in one burst. Each version's read
 * sends its statistics, then where an element holds an incident its diagram (through the one XML
 * cache, so once per caller) and the pages of its call activities' incidents, one after the other,
 * so this many versions' requests are in flight, the call activities' up to 8 each.
 */
const VERSION_READS_AT_ONCE = 4

/**
 * Versions a call reads each of while the caller's statistics floor is cold: two rounds of reads
 * at once. Up to it, the engine-wide statistics read, the costliest runtime read on a large
 * engine, would cost more than the reads of idle versions it spares, so a call reads every version
 * asked, an idle one answering all zero; past it, the call sends that read (`readStatistics`), and
 * it answers the caller's other views for 30 s. The same numbers either way.
 */
const COLD_FLOOR_VERSIONS = 2 * VERSION_READS_AT_ONCE

/** Keys a caller keeps the counts of per engine; past it the least recently read key's go. */
const KEYS_PER_CALLER = 4

/** Callers whose keys an engine keeps; past it the least recently active caller's go. */
const CALLERS_PER_ENGINE = 16

/**
 * What chooses the versions while the caller's statistics floor is cold: every version asked, one
 * chooser per engine client and caller for SCREEN_FLOOR_MS (30 s) or until a write (`dropOnWrite`),
 * as the statistics read is one on a warm floor. The counts it chose are kept under it (`keptKeys`).
 */
const coldFloors = createCallerCache<object>({
  maxEntries: 1,
  maxCallers: CALLERS_PER_ENGINE,
  ttlMs: SCREEN_FLOOR_MS,
  now: () => Date.now(),
  dropOnWrite: true,
})

/**
 * The keys each caller read per engine client, each with its versions' counts per chooser: the
 * statistics read that chose them, or the cold floor (`coldFloors`). A chooser answers 30 s at
 * most and a write drops it; the next chooses anew and every version is read anew under it, so a
 * version's counts go with their chooser and never sum with counts another chose: an instance
 * migrated between two versions counts once. A key's versions stay together, so a read of a key
 * never evicts its own versions, however many it holds, and one caller's keys never evict
 * another's. Per engine at most CALLERS_PER_ENGINE × KEYS_PER_CALLER (64) keys, each with the
 * counts its caller's current choosers chose (a replaced chooser's go with it, `WeakMap`): the
 * statistics read's only the versions it names held or does not list, the cold floor's at most
 * COLD_FLOOR_VERSIONS a call.
 */
const keptKeys = createCallerCache<WeakMap<object, object>>({
  maxEntries: KEYS_PER_CALLER,
  maxCallers: CALLERS_PER_ENGINE,
})

/**
 * The floor under a version's element counts: they read the statistics with every incident and the
 * incidents at the version's call activities whole, which loads the engine's database as the shared
 * process screen's read does (plan 3.2), so a caller's read of the same version while its chooser
 * answers (30 s at most) gets the counts read before, whichever view asked ("Running", the process
 * route or `engine_activity_counts`), and a Refresh within it reads nothing again. Kept under the
 * key and chooser (`keptKeys`), so the bound is theirs; a failed read is not kept.
 */
const versionFloor = createOwnerCache<readonly ElementStatisticsWithFailedJobs[]>({
  maxEntries: Infinity,
  maxCallers: 1,
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

/** A version whose element statistics are read, and the key they are kept under. */
interface VersionRead {
  key: string
  id: string
}

/** The versions a call reads, and what chose them: their counts are kept under it. */
interface ChosenVersions {
  chooser: object
  reads: VersionRead[]
}

/**
 * The versions of `asked` whose element statistics can count anything, each with its key: those
 * the engine-wide statistics name held (`KeyStats.heldVersionIds`: running instances, jobs without
 * retries or open root incidents), and those it does not list (deployed since), which it cannot say
 * hold nothing. A version's tokens and the copies its call activities hold live on its running
 * instances (a copy on the instance that waits at the call), its jobs without retries and root
 * incidents the statistics count themselves, so every other version's element statistics are all
 * zero: it counts nothing and costs no read.
 */
function heldIn(statistics: StatisticsRead, asked: readonly string[]): VersionRead[] {
  const listed = new Map<string, VersionRead & { held: boolean }>()
  for (const [key, stats] of foldStatsByKey(statistics.rows)) {
    const held = new Set(stats.heldVersionIds)
    for (const id of stats.versionIds) listed.set(id, { key, id, held: held.has(id) })
  }
  return asked.flatMap((id): VersionRead[] => {
    const version = listed.get(id)
    if (version === undefined) return [{ key: definitionKeyInId(id) ?? id, id }]
    return version.held ? [{ key: version.key, id }] : []
  })
}

/**
 * The versions of `asked` a call reads: the held ones by this caller's statistics read of the last
 * 30 s where one answered (`peekStatistics`), else, past COLD_FLOOR_VERSIONS, by one sent now
 * (primary, as every version's read is: one left out would undercount the key), else every one,
 * under the caller's cold floor.
 */
async function versionsToRead(client: Client, asked: readonly string[]): Promise<ChosenVersions> {
  const statistics =
    peekStatistics(client) ??
    (asked.length > COLD_FLOOR_VERSIONS ? await readStatistics(client) : undefined)
  if (statistics !== undefined) return { chooser: statistics, reads: heldIn(statistics, asked) }
  const chooser = await coldFloors(client, "cold", () => Promise.resolve({}))
  return { chooser, reads: asked.map((id) => ({ key: definitionKeyInId(id) ?? id, id })) }
}

/** The owner `chooser`'s counts of a key are kept under, in the key's `owners`. */
function ownerUnder(owners: WeakMap<object, object>, chooser: object): object {
  const known = owners.get(chooser)
  if (known !== undefined) return known
  const owner = {}
  owners.set(chooser, owner)
  return owner
}

/**
 * The counts on the diagrams of `versionIds`, summed per element, by the rule the shared process
 * screen reads them with: each version's element statistics (c7-core's `ElementStatisticsReader`
 * over the server's wire, with each element's jobs without retries and every incident at an
 * element from the same one statistics read, a multi-instance body's counts on the activity it
 * repeats), whose incidents are root incidents wherever no copy can lie, and which reads the
 * incidents at the version's call activities whole to tell the root incidents raised there from
 * the copies a call activity holds of its called instances' (`isRootIncident`), the named exception
 * to "never a scan" (invariant 7), since the read is whole and never a capped page. Only versions
 * that can count something are read where the caller's statistics say which, a few asked on a cold
 * floor each (`versionsToRead`), at most {@link VERSION_READS_AT_ONCE} at once, each kept while
 * what chose it answers (`versionFloor`). Every version's read is primary, and so is a statistics
 * read sent to choose them: one left out would undercount the key.
 */
export async function readElementCounts(
  client: Client,
  versionIds: readonly string[],
): Promise<Map<string, ElementCounts>> {
  const byElement = new Map<string, ElementCounts>()
  const asked = [...new Set(versionIds)]
  if (asked.length === 0) return byElement
  const runtime = c7RuntimeOf(client)
  const { chooser, reads } = await versionsToRead(client, asked)
  const perVersion = await mapLimit(reads, VERSION_READS_AT_ONCE, async ({ key, id }) => {
    const owners = await keptKeys(client, key, () => Promise.resolve(new WeakMap()))
    return versionFloor(ownerUnder(owners, chooser), id, () =>
      runtime.getElementStatisticsWithFailedJobs(DefinitionId(id)),
    )
  })
  for (const element of perVersion.flat()) {
    const id = element.elementId
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
