import type { PageCursor } from "../../../model/ids.js"
import type { Page, PageRequest } from "../../../model/queries.js"
import { Ensure } from "../ensure.js"
import { MAX_PAGES } from "./instance-reads.js"

export class PageWalk {
  static async pages<Item>(
    read: (page: PageRequest) => Promise<Page<Item>>,
    limit: number,
  ): Promise<readonly Item[][]> {
    const pages: Item[][] = []
    let after: PageCursor | undefined
    for (let count = 1; count <= MAX_PAGES; count += 1) {
      const page = await read(after === undefined ? { limit } : { limit, after })
      pages.push([...page.items])
      if (page.next === undefined) {
        break
      }
      after = page.next
    }
    return pages
  }

  static ensureFull(pages: readonly (readonly unknown[])[], limit: number, law: string): void {
    pages.forEach((items, index) => {
      const last = index === pages.length - 1
      Ensure.that(
        items.length === limit || (last && items.length < limit),
        law,
        `page ${index + 1} of ${pages.length} held ${items.length}, its limit is ${limit}`,
      )
    })
  }
}
