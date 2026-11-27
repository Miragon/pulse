/**
 * The open incidents the status triage reads, and the incidents' order and tie rule, which the
 * engine contract's search (`runtime/incident-search.ts`) reads them by too. The triage reads the
 * newest of a scope up to its cap, each once, a copy in a calling instance too (which it counts as
 * `propagated`). `GET /incident` sorts by `incidentTimestamp` alone, so incidents raised at one
 * instant come in an order that may differ from one request to the next, and a page of 500 at a
 * plain offset that falls between them would repeat one of them and drop another. The triage reads
 * its incidents in pages of `TiedPages` (`tied-pages.ts`) instead, walked by their cursors: newest
 * first, then by id, every run of up to 500 rows raised at one instant read whole within one
 * request, no request for more than 500 rows. A page asks for every incident the cap leaves and
 * reads them in windows of 500 rows, each from the last run of the one before, which it reads
 * again: five requests for the newest 2,000 of 2,001 incidents or more where those five runs hold
 * 499 rows or fewer in all, as on the engines measured (up to 6 incidents in one millisecond); a
 * page sends 10 requests at most, and the walk goes on with the next.
 *
 * Every request after the first asks only for the incidents raised strictly before a millisecond
 * after the first answer's newest one (`incidentTimestampBefore`, which both engines read so), so
 * the incidents raised while the walk reads, the newest, shift none of its offsets. An incident the
 * walk holds is never listed again, a row the next page drops: one that an incident committed
 * during the walk with an earlier timestamp pushed to a later offset, and a row of a run of more
 * than 500 raised at one instant, which keeps the engine's order at plain offsets, so that where
 * the database orders the run anew between two requests its rows may repeat, and about as many be
 * missed (`TiedPages`). An incident resolved during the walk shifts the rows after it to earlier
 * offsets, so one the walk has not read may move before the next window and be missed, as in every
 * read at offsets. An answer with more rows than its window asked for is the engine's whole list
 * (it ignores the paging) and ends the walk with it, as `port.list` ends its read; so does a page
 * that brings no incident the walk does not hold, `truncated` where it names a next one.
 */

import type { PageCursor } from "@miragon/pulse-engine-core"
import { engineDateMillis, engineFormat } from "./dates.js"
import {
  type EnginePort,
  type ListResult,
  type OffsetWindow,
  PAGE_SIZE,
  type PlannedRequest,
  pageQuery,
  type Query,
} from "./port.js"
import { field, type Rec, records, str } from "./records.js"
import { queryInput } from "./requests.js"
import { type TiedRow, TiedPages } from "./tied-pages.js"
import { compact } from "./util.js"

/** The incidents newest first, by the engine's one sort key (`TiedPages` orders ties by id). */
export const NEWEST_FIRST = { sortBy: "incidentTimestamp", sortOrder: "desc" } as const

/** What an incident is placed by in its order. */
export interface IncidentPlace {
  readonly id: string
  readonly incidentTimestamp: string
}

/**
 * An incident row as `TiedPages` places it: tied with the rows of the same timestamp as the engine
 * writes it (one instant in one text), ordered among them by its id; `item` the page's, or none for
 * a row the page drops.
 */
export function tiedIncident<Item>(row: IncidentPlace, item: Item | undefined): TiedRow<Item> {
  return { key: row.incidentTimestamp, id: row.id, item }
}

/**
 * The request of the incidents `filter` finds in `window`, newest first; of the walk's first
 * request, as a preview shows it.
 */
export function newestIncidentsRequest(
  filter: Query,
  window: OffsetWindow = { firstResult: 0, maxResults: PAGE_SIZE },
): PlannedRequest {
  const query = { ...NEWEST_FIRST, ...filter }
  return {
    operationId: "getIncidents",
    input: queryInput(pageQuery(query, window.firstResult, window.maxResults)),
  }
}

const placeOf = (row: Rec): IncidentPlace => ({
  id: field(row, "id"),
  incidentTimestamp: field(row, "incidentTimestamp"),
})

/** A millisecond after the timestamp of `row`, in the engine's format; null where none parses. */
function justAfter(row: Rec | undefined): string | null {
  const millis = engineDateMillis(str(row, "incidentTimestamp"))
  return millis === null ? null : engineFormat(millis + 1)
}

/** The incidents a walk holds, each once, and what its requests ask for. */
class IncidentWalk {
  readonly items: Rec[] = []
  /** The answer of a request that ignored its window: the engine's whole list. */
  whole: Rec[] | undefined
  private readonly held = new Set<string>()
  /** Where the requests after the first end: unknown before it, null where none can. */
  private before: string | null | undefined

  constructor(
    private readonly port: EnginePort,
    private readonly filter: Query,
  ) {}

  /**
   * The rows of `window`, after the first request those raised up to its newest one only, an
   * incident the walk holds from an earlier page as a row the page drops.
   */
  readonly read = async (window: OffsetWindow): Promise<TiedRow<Rec>[]> => {
    const before = this.before ?? undefined
    const query = { ...this.filter, ...compact({ incidentTimestampBefore: before }) }
    const { operationId, input } = newestIncidentsRequest(query, window)
    const rows = records(await this.port.json(operationId, input))
    if (this.before === undefined) this.before = justAfter(rows[0])
    if (rows.length > window.maxResults) {
      this.whole = rows
      return []
    }
    return rows.map((row) => {
      const place = placeOf(row)
      return tiedIncident(place, this.held.has(place.id) ? undefined : row)
    })
  }

  /** Adds the incidents of `items` the walk does not hold yet; whether one was new. */
  add(items: readonly Rec[]): boolean {
    const had = this.items.length
    for (const item of items) {
      const { id } = placeOf(item)
      if (!this.held.has(id)) {
        this.held.add(id)
        this.items.push(item)
      }
    }
    return this.items.length > had
  }
}

/**
 * The newest `cap` open incidents `filter` finds, each once, newest first and then by id where no
 * more than 500 were raised at one instant; `truncated` where the last page names a next one.
 */
export async function newestIncidents(
  port: EnginePort,
  filter: Query,
  cap: number,
): Promise<ListResult> {
  const walk = new IncidentWalk(port, filter)
  let after: PageCursor | undefined
  do {
    const limit = cap - walk.items.length
    const page = await new TiedPages({ limit, ...compact({ after }) }).pageOf(walk.read)
    after = page.next
    if (!walk.add(page.items)) break
  } while (after !== undefined && walk.items.length < cap && walk.whole === undefined)
  if (walk.whole === undefined) return { items: walk.items, truncated: after !== undefined }
  walk.add(walk.whole)
  return { items: walk.items.slice(0, cap), truncated: walk.items.length > cap }
}
