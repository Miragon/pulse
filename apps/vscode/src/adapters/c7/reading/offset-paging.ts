import { PageCursor, type Page, type PageRequest } from "../../../contract/index.js"

export interface OffsetWindow {
  readonly firstResult: number
  readonly maxResults: number
}

export class OffsetPaging {
  constructor(private readonly page: PageRequest) {}

  window(): OffsetWindow {
    return { firstResult: this.offset(), maxResults: this.page.limit + 1 }
  }

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
