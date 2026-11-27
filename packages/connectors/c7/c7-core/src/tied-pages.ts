/**
 * Full pages over offset paging whose one sort key ties: the engine orders by the key alone (the
 * incidents' `incidentTimestamp`, since `GET /incident` takes one sort key), so rows with the same
 * key come in an order that may differ from one request to the next, and an offset that falls
 * between them repeats one row on the next page and skips another. Here every run of up to 500 rows
 * with the same key, the rows the page drops counted too, is read whole within one request and
 * ordered by id, so the order is the same on every read, across pages too. The cursor names where
 * the next row is: `<offset>` where it is a run's first, `<offset>.<skip>` where `skip` rows of the
 * run starting there came before, by id, `<offset>~` where it keeps its plain offset in a run of
 * more than 500 rows (below).
 *
 * It fills a page as `FillingPages` of the runtime does, for a search that drops rows of the
 * engine's answer: a first window of the page and two rows more (one tells whether another page
 * follows, one whether the last run goes on) plus the rows the cursor skips, further windows while
 * it keeps fewer rows and came back full, each twice the last, every window at most the port's 500
 * rows (`PAGE_SIZE`), at most 10 requests in all. A full window's last run may go on past it, so it
 * is read again at the start of the next window; a run that fills a whole window is read again in a
 * window twice as large, and one that fills a window of 500 rows is told from a longer run by the
 * one row after it, read on its own as one of the 10 requests. A run of more than 500 rows is never
 * read whole: its rows keep the engine's order (but see the bound below), each at its plain offset
 * as `FillingPages` pages, the next window goes on where the last one ended, and a cursor into the
 * run says so, so the next page reads on from it with the page and two rows more. Each offset of
 * the run comes once, but where the engine orders the run anew between two requests, its rows may
 * repeat and about as many others be missed, even within one page, up to most of the run; the rows
 * around it never. At the bound the cursor is the first row the page has not taken, a bare offset:
 * the next page reads a full window's last run again, which may go on, and so a run of 500 rows no
 * request was left to tell from a longer one. A page at the bound may be short, even empty, but no
 * kept row is skipped. Inside a run of more than 500 rows the bare offset no longer says so, and
 * the next page reads the run's rest from it as a run of its own: a rest of more than 500 rows it
 * tells by the one row after a window of 500 and keeps at plain offsets, a rest of 500 rows or
 * fewer it reads whole and orders by id.
 */

import { type Page, PageCursor, type PageRequest } from "@miragon/pulse-engine-core"
import { type OffsetWindow, PAGE_SIZE } from "./port.js"
import { compareText } from "./records.js"

/** The most requests one page sends: its windows, the first included, and the one-row reads. */
const MOST_REQUESTS = 10

/** A row of the engine's answer: the key it is ordered by, its id, and the page's item or none. */
export interface TiedRow<Item> {
  /** Equal for rows the engine cannot tell apart in its order. */
  readonly key: string
  /** Unique: orders rows of the same key. */
  readonly id: string
  /** Undefined for a row the page drops. */
  readonly item: Item | undefined
}

/** The rows of `window`, in the engine's order. */
export type TiedRead<Item> = (window: OffsetWindow) => Promise<readonly TiedRow<Item>[]>

/** A page's reads, counted, so that it sends at most 10 requests. */
class Requests<Item> {
  private sent = 0

  constructor(private readonly reader: TiedRead<Item>) {}

  read(window: OffsetWindow): Promise<readonly TiedRow<Item>[]> {
    this.sent += 1
    return this.reader(window)
  }

  /** Whether the page has sent its last request. */
  get spent(): boolean {
    return this.sent >= MOST_REQUESTS
  }
}

/**
 * Where a page starts: an engine offset, how many rows of the run starting there came before (by
 * id, or by offset where the run is longer than 500 rows), and whether the offset goes on such a
 * run.
 */
interface TiedCursor {
  readonly start: number
  readonly skip: number
  readonly within: boolean
}

/** A run of rows with the same key, from the engine offset `start` on. */
interface Run<Item> {
  readonly start: number
  readonly key: string
  readonly rows: TiedRow<Item>[]
}

/** A row in the page's order: its item or none, and the cursor of a page that starts with it. */
interface PlacedRow<Item> {
  readonly item: Item | undefined
  readonly at: string
}

/** A row the page keeps. */
type KeptRow<Item> = PlacedRow<Item> & { readonly item: Item }

const isKept = <Item>(row: PlacedRow<Item>): row is KeptRow<Item> => row.item !== undefined

const CURSOR = /^(\d+)(?:\.(\d+)|(~))?$/

function cursorOf(after: string | undefined): TiedCursor {
  if (after === undefined) return { start: 0, skip: 0, within: false }
  const match = CURSOR.exec(after)
  const cursor = {
    start: Number(match?.[1]),
    skip: Number(match?.[2] ?? 0),
    within: match?.[3] !== undefined,
  }
  if (!Number.isSafeInteger(cursor.start + cursor.skip)) {
    throw new RangeError(`"${after}" is not a page cursor of this engine`)
  }
  return cursor
}

/** The runs of `rows`, read from the engine offset `firstResult` on. */
function runsOf<Item>(rows: readonly TiedRow<Item>[], firstResult: number): Run<Item>[] {
  const runs: Run<Item>[] = []
  rows.forEach((row, index) => {
    const last = runs.at(-1)
    if (last?.key === row.key) last.rows.push(row)
    else runs.push({ start: firstResult + index, key: row.key, rows: [row] })
  })
  return runs
}

const byId = (left: TiedRow<unknown>, right: TiedRow<unknown>): number =>
  compareText(left.id, right.id)

/**
 * A window to read, and the run of more than 500 rows its first row goes on: by key, `true` where
 * the page's cursor says so (`<offset>~`), `false` where its first row starts a run.
 */
interface Reading {
  readonly window: OffsetWindow
  readonly goesOn: string | boolean
}

/** The first window: from the cursor, the rows it skips, the page and two more, up to 500. */
function firstReading(cursor: TiedCursor, limit: number): Reading {
  const maxResults = Math.min(cursor.skip + limit + 2, PAGE_SIZE)
  return { window: { firstResult: cursor.start, maxResults }, goesOn: cursor.within }
}

/** The window after one that came back full: from `firstResult`, twice its rows up to 500. */
function grown(window: OffsetWindow, firstResult: number): OffsetWindow {
  return { firstResult, maxResults: Math.min(window.maxResults * 2, PAGE_SIZE) }
}

/** What a window gave, and where the next one starts. */
interface WindowRuns<Item> {
  /** The run of more than 500 rows the window starts in, if any: its rows keep their offsets. */
  readonly long: readonly Run<Item>[]
  /** The window's other runs, each read whole. */
  readonly runs: readonly Run<Item>[]
  readonly full: boolean
  readonly next: number
  /** The key of the run of more than 500 rows the next window may go on, else `false`. */
  readonly goesOn: string | false
}

/**
 * A window whose first run is one of more than 500 rows: the next window starts at its last run,
 * which may go on, or, where the long run fills the window, where the window ended, on that run.
 */
function longOf<Item>(
  long: Run<Item>,
  runs: Run<Item>[],
  full: boolean,
  end: number,
): WindowRuns<Item> {
  const open = full ? runs.pop() : undefined
  if (open !== undefined) return { long: [long], runs, full, next: open.start, goesOn: false }
  return { long: [long], runs, full, next: end, goesOn: long.key }
}

/** A window of runs read whole, the last read again at the next window's start if it may go on. */
function wholeOf<Item>(runs: Run<Item>[], full: boolean, end: number): WindowRuns<Item> {
  const open = full ? runs.pop() : undefined
  return { long: [], runs, full, next: open?.start ?? end, goesOn: false }
}

/** Whether the run that filled a window of 500 rows goes on: the row after it has its key. */
async function goesOnPast<Item>(requests: Requests<Item>, run: Run<Item>): Promise<boolean> {
  const [after] = await requests.read({ firstResult: run.start + PAGE_SIZE, maxResults: 1 })
  return after?.key === run.key
}

/**
 * The runs of a window's rows, or none where one run fills it and cannot be placed yet: a window
 * below 500 rows, which is then read again in one twice as large (windows double from 3 rows on, so
 * the ninth holds 500 and none after it comes here), or one of 500 rows where no request is left
 * for the row after it. A window that goes on a run of more than 500 rows starts with its rest. A
 * run that fills a window of 500 rows is the window's one run: read whole where the row after it
 * starts another run or none follows, else the start of a run of more than 500 rows.
 */
async function windowRunsOf<Item>(
  requests: Requests<Item>,
  { window, goesOn }: Reading,
): Promise<WindowRuns<Item> | undefined> {
  const rows = await requests.read(window)
  const full = rows.length >= window.maxResults
  const runs = runsOf(rows, window.firstResult)
  const end = window.firstResult + rows.length
  const [first, ...rest] = runs
  if (first !== undefined && (goesOn === true || first.key === goesOn)) {
    return longOf(first, rest, full, end)
  }
  const run = full && runs.length === 1 ? first : undefined
  if (run === undefined) return wholeOf(runs, full, end)
  if (window.maxResults < PAGE_SIZE || requests.spent) return undefined
  if (await goesOnPast(requests, run)) return longOf(run, [], full, end)
  return { long: [], runs, full, next: end, goesOn: false }
}

/** The rows of a run read whole, ordered by id, from its `skip`th on. */
function byIdOf<Item>(run: Run<Item>, skip: number): PlacedRow<Item>[] {
  return [...run.rows]
    .sort(byId)
    .slice(skip)
    .map(({ item }, index) => {
      const at = skip + index
      return { item, at: at === 0 ? String(run.start) : `${String(run.start)}.${String(at)}` }
    })
}

/** The rows of a run of more than 500 rows in the engine's order, from the offset `from` on. */
function atOffsetsOf<Item>(run: Run<Item>, from: number): PlacedRow<Item>[] {
  return run.rows
    .map(({ item }, index) => ({ item, offset: run.start + index }))
    .filter(({ offset }) => offset >= from)
    .map(({ item, offset }) => ({ item, at: `${String(offset)}~` }))
}

/** The rows of a window in the page's order, without what the cursor skips. */
function placedOf<Item>(got: WindowRuns<Item>, cursor: TiedCursor): PlacedRow<Item>[] {
  const long = got.long.flatMap((run) => atOffsetsOf(run, cursor.start + cursor.skip))
  const runs = got.runs.flatMap((run) => byIdOf(run, run.start === cursor.start ? cursor.skip : 0))
  return [...long, ...runs]
}

/** A page by its cursor, its runs of tied rows ordered by id, one of more than 500 by offset. */
export class TiedPages {
  constructor(private readonly page: PageRequest) {}

  /**
   * The page of the rows `read` keeps, and the cursor of the next kept row if one follows. A
   * cursor that is none of this paging fails as a `RangeError` before anything is read.
   */
  async pageOf<Item>(read: TiedRead<Item>): Promise<Page<Item>> {
    const cursor = cursorOf(this.page.after)
    const requests = new Requests(read)
    const kept: KeptRow<Item>[] = []
    let reading = firstReading(cursor, this.page.limit)
    for (;;) {
      const { window } = reading
      const got = await windowRunsOf(requests, reading)
      if (got === undefined && requests.spent) return this.bound(kept, window.firstResult)
      if (got === undefined) {
        reading = { window: grown(window, window.firstResult), goesOn: false }
        continue
      }
      kept.push(...placedOf(got, cursor).filter(isKept))
      if (kept.length > this.page.limit || !got.full) return this.cut(kept)
      if (requests.spent) return this.bound(kept, got.next)
      reading = { window: grown(window, got.next), goesOn: got.goesOn }
    }
  }

  private cut<Item>(kept: readonly KeptRow<Item>[]): Page<Item> {
    const items = kept.slice(0, this.page.limit).map(({ item }) => item)
    const following = kept[this.page.limit]
    return following === undefined ? { items } : { items, next: PageCursor(following.at) }
  }

  /** The page at the bound of requests: what it kept, its cursor the first row it has not taken. */
  private bound<Item>(kept: readonly KeptRow<Item>[], next: number): Page<Item> {
    return { items: kept.map(({ item }) => item), next: PageCursor(String(next)) }
  }
}
