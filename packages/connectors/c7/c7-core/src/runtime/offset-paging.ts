/**
 * Offset paging behind the engine contract's cursor (`PageRequest`, `Page` of
 * @miragon/pulse-engine-core): the cursor is the offset of the next row, and one row more than the
 * page is asked for, so a page tells whether another follows without a count. A search that drops
 * rows of the engine's answer fills its page with `FillingPages` (`filling-pages.ts`), whose first
 * window is this one.
 */

import { type Page, PageCursor, type PageRequest } from "@miragon/pulse-engine-core"

/** The rows of a request: `firstResult` and `maxResults`, the engine's paging. */
export interface OffsetWindow {
  readonly firstResult: number
  readonly maxResults: number
}

/** A page by its offset. */
export class OffsetPaging {
  constructor(private readonly page: PageRequest) {}

  /**
   * The rows to ask for: the page from its offset and one more. A cursor that is no offset of
   * this paging fails as a `RangeError`.
   */
  window(): OffsetWindow {
    return { firstResult: this.offset(), maxResults: this.page.limit + 1 }
  }

  /**
   * The page of `rows` (read by {@link window}), its items by `toItems`, one per row, and the next
   * cursor if more follow.
   */
  pageOf<Row, Item>(
    rows: readonly Row[],
    toItems: (pageRows: readonly Row[]) => readonly Item[],
  ): Page<Item> {
    const items = toItems(rows.slice(0, this.page.limit))
    if (rows.length <= this.page.limit) {
      return { items }
    }
    return { items, next: PageCursor(String(this.offset() + this.page.limit)) }
  }

  private offset(): number {
    const cursor = this.page.after
    if (cursor === undefined) {
      return 0
    }
    const offset = Number(cursor)
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new RangeError(`"${cursor}" is not a page cursor of this engine`)
    }
    return offset
  }
}
