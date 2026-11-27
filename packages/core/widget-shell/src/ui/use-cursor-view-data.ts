import { useMemo } from "react"
import { type PagedViewOptions, type Paging, usePagedRows } from "./paged-view-core.js"
import type { PagedViewData } from "./use-paged-view-data.js"

/** What a list paged by cursor reads: the feed, its arguments and how its answer reads. */
export interface CursorViewDataOptions<TItem, TData> extends PagedViewOptions<TItem, TData> {
  /** The cursor of the page after `data` (the feed's `next`), null on the last. */
  selectNext: (data: TData) => string | null
}

/** Paging by cursor: page 0 without one, each further page with the `next` of the page before. */
function byCursor<TData>(selectNext: (data: TData) => string | null): Paging<TData> {
  return {
    page0: {},
    next: (page) => {
      const after = selectNext(page)
      return after === null ? null : { after }
    },
  }
}

/**
 * The cursor-paged sibling of `usePagedViewData`, for a feed that pages by the cursor of the page
 * before (`after`, from its `next`) instead of an offset, so a page goes on where the one before
 * ended, also where the rows' order ties (#690). More follows while the last page read names a
 * `next`, so a page that comes back short or even empty with one (a feed's bound of requests) is
 * read on from. The total is page 0's, raised to what the list proves, the rows on screen and one
 * more while a page follows: the footer counts no fewer and offers "Load more" whatever page 0
 * said, which it does only over a total above 0. The same `PagedViewData`, so `PagedRows`,
 * `PagedListFooter` and the inline fit work alike.
 */
export function useCursorViewData<TItem, TData>(
  opts: CursorViewDataOptions<TItem, TData>,
): PagedViewData<TItem, TData> {
  const { selectNext } = opts
  const paging = useMemo(() => byCursor(selectNext), [selectNext])
  const paged = usePagedRows<TItem, TData>(opts, paging)
  const proven = paged.items.length + (paged.hasMore ? 1 : 0)
  return { ...paged, total: Math.max(paged.total, proven) }
}
