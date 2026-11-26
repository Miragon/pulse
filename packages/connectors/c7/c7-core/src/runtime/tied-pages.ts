/**
 * Full pages over offset paging whose one sort key ties: the engine orders by the key alone (the
 * incidents' `incidentTimestamp`, since `GET /incident` takes one sort key), so rows with the same
 * key come in an order that may differ from one request to the next, and an offset that falls
 * between them repeats one row on the next page and skips another. Here every run of rows with the
 * same key is read whole within one request and ordered by id, so the order is the same on every
 * read, across pages too, and the cursor names where such a run starts in the engine's order and
 * how many of its rows came before: `<offset>` where the next row is a run's first, else
 * `<offset>.<skip>`.
 *
 * It fills a page as {@link FillingPages} does, for a search that drops rows of the engine's answer:
 * a first window of the page and two rows more (one tells whether another page follows, one whether
 * the last run goes on) plus the rows the cursor skips, further windows while it keeps fewer rows
 * and came back full, each twice the last up to `readAll`'s 500 rows, at most 10 windows in all. A
 * full window's last run may go on past it, so it is read again at the start of the next window; a
 * run that fills a whole window is read again in a window twice as large. A run of more than 500
 * rows, raised at one instant, is ordered by id only within each window, so its pages may repeat or
 * miss one of its rows. At the bound the cursor is the first row not read: that page may be short,
 * even empty, but no kept row is skipped.
 */

import { type Page, PageCursor, type PageRequest } from "@miragon/pulse-engine-core"
import { compareText } from "../records.js"
import type { OffsetWindow } from "./offset-paging.js"
import { PAGE_SIZE } from "./read-all.js"

/** The most windows one page reads, the first included. */
const MOST_WINDOWS = 10

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

/** Where a page starts: a run's engine offset and how many of its rows (by id) came before. */
interface TiedCursor {
  readonly start: number
  readonly skip: number
}

/** A run of rows with the same key, from the engine offset `start` on. */
interface Run<Item> {
  readonly start: number
  readonly key: string
  readonly rows: TiedRow<Item>[]
}

/** A row in the page's order: its item or none, its run's engine offset and its place in the run. */
interface PlacedRow<Item> {
  readonly item: Item | undefined
  readonly start: number
  readonly index: number
}

/** A row the page keeps. */
type KeptRow<Item> = PlacedRow<Item> & { readonly item: Item }

const isKept = <Item>(row: PlacedRow<Item>): row is KeptRow<Item> => row.item !== undefined

const CURSOR = /^(\d+)(?:\.(\d+))?$/

function cursorOf(after: string | undefined): TiedCursor {
  if (after === undefined) return { start: 0, skip: 0 }
  const match = CURSOR.exec(after)
  const cursor = { start: Number(match?.[1]), skip: Number(match?.[2] ?? 0) }
  if (!Number.isSafeInteger(cursor.start + cursor.skip)) {
    throw new RangeError(`"${after}" is not a page cursor of this engine`)
  }
  return cursor
}

function cursorAt({ start, index }: PlacedRow<unknown>): PageCursor {
  return PageCursor(index === 0 ? String(start) : `${String(start)}.${String(index)}`)
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

/** The window after one that came back full: from `firstResult`, twice its rows up to 500. */
function grown(window: OffsetWindow, firstResult: number): OffsetWindow {
  return { firstResult, maxResults: Math.min(window.maxResults * 2, PAGE_SIZE) }
}

/** What a window gave: its runs read whole, whether it came back full, where the next one starts. */
interface WindowRuns<Item> {
  readonly runs: readonly Run<Item>[]
  readonly full: boolean
  readonly next: number
}

/**
 * The runs of `window`'s rows read whole, or none where one run fills the window, which is then read
 * again in one twice as large (windows double from 3 rows on, so the ninth holds 500 and none after
 * it comes here). A full window's last run may go on past it: the next window starts there.
 */
function windowRunsOf<Item>(
  rows: readonly TiedRow<Item>[],
  window: OffsetWindow,
): WindowRuns<Item> | undefined {
  const full = rows.length >= window.maxResults
  const runs = runsOf(rows, window.firstResult)
  if (full && runs.length === 1 && window.maxResults < PAGE_SIZE) return undefined
  const open = full && runs.length > 1 ? runs.pop() : undefined
  return { runs, full, next: open?.start ?? window.firstResult + rows.length }
}

/** The rows of `runs` in the page's order, each run by id, without what the cursor skips. */
function placedOf<Item>(runs: readonly Run<Item>[], cursor: TiedCursor): PlacedRow<Item>[] {
  return runs.flatMap((run) =>
    [...run.rows]
      .sort(byId)
      .map(({ item }, index) => ({ item, start: run.start, index }))
      .filter(({ index }) => run.start !== cursor.start || index >= cursor.skip),
  )
}

/** A page by its cursor, its runs of tied rows ordered by id. */
export class TiedPages {
  constructor(private readonly page: PageRequest) {}

  /**
   * The page of the rows `read` keeps, and the cursor of the next kept row if one follows. A
   * cursor that is none of this paging fails as a `RangeError` before anything is read.
   */
  async pageOf<Item>(read: TiedRead<Item>): Promise<Page<Item>> {
    const cursor = cursorOf(this.page.after)
    const placed: PlacedRow<Item>[] = []
    const maxResults = cursor.skip + this.page.limit + 2
    let window: OffsetWindow = { firstResult: cursor.start, maxResults }
    for (let windows = 1; ; windows += 1) {
      const got = windowRunsOf(await read(window), window)
      if (got === undefined) {
        window = grown(window, window.firstResult)
        continue
      }
      placed.push(...placedOf(got.runs, cursor))
      const kept = placed.filter(isKept)
      if (kept.length > this.page.limit || !got.full) return this.cut(kept)
      if (windows === MOST_WINDOWS) return this.bound(placed, got.next)
      window = grown(window, got.next)
    }
  }

  private cut<Item>(kept: readonly KeptRow<Item>[]): Page<Item> {
    const items = kept.slice(0, this.page.limit).map(({ item }) => item)
    const following = kept[this.page.limit]
    return following === undefined ? { items } : { items, next: cursorAt(following) }
  }

  /** The page at the bound of windows: what it kept, its cursor the first row not read. */
  private bound<Item>(placed: readonly PlacedRow<Item>[], next: number): Page<Item> {
    const items = placed.filter(isKept).map(({ item }) => item)
    return { items, next: PageCursor(String(next)) }
  }
}
