/**
 * "With incident" per version of what a list of processes or of a process's versions shows
 * (`DefinitionReader`): over the whole engine's instances with an open incident for the processes,
 * over the process's own (`processDefinitionKey`) for its versions. One page of those instances,
 * read beside the statistics, gives the counts while it holds them all. Past a full page, one
 * count of them picks the path that sends fewer requests: the listing read on from where the page
 * ended to its end, in its order by id, or one count per version that runs an instance, at most
 * `PARALLEL` at a time, since a version without running instances holds none with an incident.
 * So beside the statistics a list sends the first page, the one count and the fewer of the pages
 * left and the running versions (the listing where both send as many). Every number is the
 * engine's own, a listing read to its end or a count, never a capped page. On a live engine the
 * count only picks the path: incidents raised or resolved since leave the numbers to the path's
 * own reads, and a listing longer than the count still reads to its end.
 */

import { type EnginePort, PAGE_SIZE, PARALLEL } from "../port.js"
import { mapLimit } from "../util.js"
import {
  countWithIncident,
  type IncidentScope,
  withIncidentListing,
  withIncidentOfListed,
} from "../with-incident.js"
import { readFrom, readPage } from "./read-all.js"

/** A version (its definition id) and the instances that run on it, as its statistics count them. */
export interface RunningVersion {
  readonly id: string
  readonly instances: number
}

/** The versions a list counts "with incident" for: the whole engine's, or one process's by its key. */
export type ProcessScope = Pick<IncidentScope, "processDefinitionKey">

/**
 * How a list counts past a full first page: `listing` reads the pages left, `perVersion` counts
 * each version that runs an instance.
 */
export type WithIncidentPath = "listing" | "perVersion"

/** How a list counts "with incident" per version: its page, and which path follows a full one. */
export interface WithIncidentCounting {
  /** The rows a page of the scope's instances with an open incident asks for, 500 without it. */
  readonly pageSize?: number
  /** The path past a full first page; without it, the one that sends fewer requests. */
  readonly path?: WithIncidentPath
}

/**
 * The requests that read the listing on past its first page of `size` for `count` rows: a page
 * holding fewer than `size` is the last, so a count that fills its last page costs one more.
 */
function pagesLeftFor(count: number, size: number): number {
  return Math.floor(Math.max(0, count - size) / size) + 1
}

/** The path that sends fewer requests past a full first page, the listing where both send as many. */
function cheaperPath(count: number, size: number, runningVersions: number): WithIncidentPath {
  return pagesLeftFor(count, size) <= runningVersions ? "listing" : "perVersion"
}

/** Each of `running` with its instances with an open incident, one count each. */
async function countedPerVersion(
  port: EnginePort,
  running: readonly RunningVersion[],
): Promise<Map<string, number>> {
  const counts = await mapLimit(running, PARALLEL, async ({ id }) => {
    const count = await countWithIncident(port, { processDefinitionId: id })
    return [id, count] as const
  })
  return new Map(counts)
}

/**
 * Per version of `versions`, the versions of `scope`, how many of its instances hold an open
 * incident, by the rule of this module; a version without an entry has none. The first page is
 * read beside the statistics `versions` comes from, so a short scope takes no round of its own.
 */
export async function withIncidentPerVersion(
  port: EnginePort,
  scope: ProcessScope,
  versions: Promise<readonly RunningVersion[]>,
  counting: WithIncidentCounting = {},
): Promise<Map<string, number>> {
  const size = Math.max(1, counting.pageSize ?? PAGE_SIZE)
  const read = { operationId: "getProcessInstances", query: withIncidentListing(scope) }
  const [first, known] = await Promise.all([
    readPage(port, read, { firstResult: 0, maxResults: size }),
    versions,
  ])
  if (first.length < size) return withIncidentOfListed(first)
  const running = known.filter((version) => version.instances > 0)
  const count = await countWithIncident(port, scope)
  if ((counting.path ?? cheaperPath(count, size, running.length)) === "perVersion") {
    return countedPerVersion(port, running)
  }
  const rest = await readFrom(port, read, { firstResult: size, maxResults: size })
  return withIncidentOfListed([...first, ...rest])
}
