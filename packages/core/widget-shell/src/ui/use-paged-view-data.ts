import {
  type PagedViewData,
  type PagedViewOptions,
  type Paging,
  usePagedRows,
} from "./paged-view-core.js"

export type { PagedViewData }

/**
 * Paging by offset: page 0 from the first row, each further page from the row after those shown,
 * while page 0's `total` counts more; a page shorter than the page size means the server is out
 * of rows, whatever `total` claims.
 */
const BY_OFFSET: Paging<unknown> = {
  page0: { firstResult: 0 },
  next: (_page, rows) =>
    (rows.later && rows.page < rows.pageSize) || rows.all >= rows.total
      ? null
      : { firstResult: rows.all },
}

/**
 * Offset-paginated sibling of `useViewData`; page 0 is seeded so
 * a write's invalidation refetches a standalone list too. The feed must return
 * the full filtered `total`. Button-driven, not infinite scroll.
 */
export function usePagedViewData<TItem, TData>(
  opts: PagedViewOptions<TItem, TData>,
): PagedViewData<TItem, TData> {
  return usePagedRows<TItem, TData>(opts, BY_OFFSET)
}
