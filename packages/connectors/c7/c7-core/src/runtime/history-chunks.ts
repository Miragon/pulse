/**
 * The history's instance query over an id list of any length: one request carries at most
 * `HISTORY_ID_CHUNK` ids (500), so a longer list (the runtime's instances with an incident in a
 * scope during an incident storm, the ids a caller names) goes in chunks of it. Each id goes once,
 * so no instance is in two chunks: a count is the sum of the chunks' counts, exact, from the
 * history's count and never a capped page. A window of rows is the merge of each chunk's rows up
 * to the window's end in the history's order (`NEWEST_FIRST`): one request per chunk, none asking
 * for more rows than a chunk holds ids, since the history holds one row per instance. The merge
 * keeps each chunk's rows in the order the engine sent them and takes the newest of the chunks'
 * next rows, so a longer window begins with the rows of a shorter one: while the list and the
 * engine's order hold, the pages of one list neither repeat nor skip a row, even where the
 * database orders two ids otherwise than their code units do. A list of no more ids goes whole,
 * as it is. Pure.
 */

import { PAGE_SIZE } from "../port.js"
import { compareText, compareTime } from "../records.js"

/**
 * The most instance ids one request to the history's instances carries: as many as readAll's page
 * holds rows, so no chunk's read asks for more rows than a page of any other list.
 */
export const HISTORY_ID_CHUNK = PAGE_SIZE

/** The newest instance first; the id breaks a tie, so a page is stable. */
export const NEWEST_FIRST = [
  { sortBy: "startTime", sortOrder: "desc" },
  { sortBy: "instanceId", sortOrder: "asc" },
] as const

/** What the chunks read of a query: the instance ids it names, if any. */
interface ByIds {
  readonly processInstanceIds?: readonly string[]
}

/** What the merge reads of a row: its id and its start. */
interface Started {
  readonly id: string
  readonly startTime?: string
}

/** A chunk's rows and the next of them the merge has not taken. */
interface Lane<Row> {
  readonly rows: readonly Row[]
  next: number
}

/**
 * `query` once per chunk of at most `chunk` of its ids, each id once and in its order; `query`
 * itself while it names no more ids. A chunk that is no whole number above 0 fails as a
 * `RangeError` before anything is split.
 */
export function chunkedQueries<Query extends ByIds>(
  query: Query,
  chunk: number,
): readonly [Query, ...Query[]] {
  if (!Number.isSafeInteger(chunk) || chunk < 1) {
    throw new RangeError(`${String(chunk)} instance ids per request is no chunk`)
  }
  const ids = query.processInstanceIds
  if (ids === undefined || ids.length <= chunk) {
    return [query]
  }
  const distinct = [...new Set(ids)]
  const from = (start: number): Query => ({
    ...query,
    processInstanceIds: distinct.slice(start, start + chunk),
  })
  const more: Query[] = []
  for (let start = chunk; start < distinct.length; start += chunk) {
    more.push(from(start))
  }
  return [from(0), ...more]
}

/** Below 0 when `left` comes first in the history's order: the later start, then the lower id. */
function newestFirst(left: Started, right: Started): number {
  return compareTime(right.startTime, left.startTime) || compareText(left.id, right.id)
}

/** Of the lanes' next rows the one the history lists first, with its lane; none once all are taken. */
function firstOf<Row extends Started>(
  lanes: readonly Lane<Row>[],
): { readonly lane: Lane<Row>; readonly row: Row } | undefined {
  let first: { readonly lane: Lane<Row>; readonly row: Row } | undefined
  for (const lane of lanes) {
    const row = lane.rows[lane.next]
    if (row !== undefined && (first === undefined || newestFirst(row, first.row) < 0)) {
      first = { lane, row }
    }
  }
  return first
}

/**
 * The first `most` rows of `chunks` in the history's order, each chunk's rows in the order the
 * engine sent them: of the chunks' next rows the newest, then the lowest id, then the earlier
 * chunk.
 */
export function mergedNewestFirst<Row extends Started>(
  chunks: readonly (readonly Row[])[],
  most: number,
): Row[] {
  const lanes = chunks.map((rows): Lane<Row> => ({ rows, next: 0 }))
  const merged: Row[] = []
  while (merged.length < most) {
    const first = firstOf(lanes)
    if (first === undefined) {
      break
    }
    merged.push(first.row)
    first.lane.next += 1
  }
  return merged
}
