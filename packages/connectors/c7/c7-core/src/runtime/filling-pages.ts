/**
 * Full pages over offset paging for a search that drops rows of the engine's answer (an instance
 * with an open incident when those without are asked for, an incident copied up from a called
 * instance): a page holds its limit while more rows follow, up to a bound of windows. From the
 * cursor's offset it reads a first window of the page and one row more, as {@link OffsetPaging}
 * asks for; only while that holds fewer kept rows and came back full, further windows from where
 * the last one ended, each twice the last up to `readAll`'s 500 rows, at most 10 windows in all,
 * the first included. The cut is in the engine's order: the page is the first `limit` kept rows
 * and its cursor the engine offset of the next kept row, so no dropped row before it is read again.
 * At the bound the cursor is the first row not read: that page may be short, even empty, but no
 * kept row is skipped.
 */

import { type Page, PageCursor, type PageRequest } from "@miragon/pulse-engine-core"
import { OffsetPaging, type OffsetWindow } from "./offset-paging.js"
import { PAGE_SIZE } from "./read-all.js"

/** The most windows one page reads, the first included. */
const MOST_WINDOWS = 10

/**
 * The rows of `window`, in the engine's order, each as the page's item, undefined for a row the
 * page drops.
 */
export type WindowRead<Item> = (window: OffsetWindow) => Promise<readonly (Item | undefined)[]>

/** A kept row: its item and its engine offset. */
interface KeptRow<Item> {
  readonly item: Item
  readonly offset: number
}

/** The kept rows of a window's `items`, read from the engine offset `firstResult` on. */
function keptOf<Item>(items: readonly (Item | undefined)[], firstResult: number): KeptRow<Item>[] {
  return items.flatMap((item, index) =>
    item === undefined ? [] : [{ item, offset: firstResult + index }],
  )
}

/** The window after `window`, which came back full: from where it ended, twice its rows up to 500. */
function windowAfter(window: OffsetWindow): OffsetWindow {
  return {
    firstResult: window.firstResult + window.maxResults,
    maxResults: Math.min(window.maxResults * 2, PAGE_SIZE),
  }
}

/** A page by its offset, filled from as many windows as its kept rows need. */
export class FillingPages {
  constructor(private readonly page: PageRequest) {}

  /**
   * The page of the rows `read` keeps, and the cursor of the next kept row if one follows. A
   * cursor that is no offset of this paging fails as a `RangeError` before anything is read.
   */
  async pageOf<Item>(read: WindowRead<Item>): Promise<Page<Item>> {
    const kept: KeptRow<Item>[] = []
    let window = new OffsetPaging(this.page).window()
    for (let windows = 1; ; windows += 1) {
      const items = await read(window)
      kept.push(...keptOf(items, window.firstResult))
      if (kept.length > this.page.limit || items.length < window.maxResults) {
        return this.cut(kept)
      }
      const next = windowAfter(window)
      if (windows === MOST_WINDOWS) {
        return { items: kept.map(({ item }) => item), next: PageCursor(String(next.firstResult)) }
      }
      window = next
    }
  }

  private cut<Item>(kept: readonly KeptRow<Item>[]): Page<Item> {
    const items = kept.slice(0, this.page.limit).map(({ item }) => item)
    const following = kept[this.page.limit]
    return following === undefined
      ? { items }
      : { items, next: PageCursor(String(following.offset)) }
  }
}
