/**
 * The paged list of a view, one implementation for both ways a feed pages
 * (`usePagedViewData` by offset, `useCursorViewData` by the cursor of the page
 * before): page 0 seeded and read through `useViewData`, so a write's
 * invalidation reads it anew, kept on screen while the same list reads anew;
 * each further page (Load more) read with the arguments its `Paging` names
 * after the page before, its rows put after those shown; a page 0 read anew
 * starts the list over, since the pages after it went on from the one before.
 * Button-driven, not infinite scroll.
 */

import { useCallback, useMemo, useState } from "react"
import { useResetOnChange } from "@miragon/pulse-ui"
import { decodeToolResult } from "../protocol/tool-result.js"
import type { InlineRows } from "./inline-fit.js"
import {
  canRetry,
  footerFailure,
  useDescribeRefusal,
  useInlineHead,
  useSameListPlaceholder,
  useShownPage,
} from "./paged-view-parts.js"
import { useViewData, type ViewDataResult } from "./tool-query.js"
import { useViewHost } from "./view-host.js"

export interface PagedViewData<TItem, TData = unknown> {
  /** Inline under a host, at most the rows that fit the height budget (#396). */
  items: TItem[]
  /** While a new page 0 is in flight or failed, the previous result stays ({@link stale}). */
  firstPage: TData | null
  total: number
  /**
   * The rows on screen are the PREVIOUS filter's result: anything said about
   * them must read the payload on screen, never the request.
   */
  stale: boolean
  hasMore: boolean
  loadMore: () => void
  loading: boolean
  /** A page 0 is in flight while rows are on screen (a changed filter, a refetch). */
  refreshing: boolean
  loadingMore: boolean
  /**
   * The page-0 failure. Over rows on screen it is set from the FIRST failed
   * attempt, so the list never presents them as current through the backoff;
   * a page's ended session is the page frame's to say, so over rows it is none.
   */
  error: Error | null
  /** A new read at once, also during the client's retry backoff. */
  retry: () => void
  /** The last load-more failure; none for a page's ended session, which the page's frame says. */
  loadMoreError: Error | null
  /**
   * False for a refusal no retry changes (`isPermanentError`): the footer offers no retry for it.
   * Always set by the hook; optional, so a hand-built list state needs none.
   */
  canRetry?: (error: Error) => boolean
  /**
   * Such a refusal in the host's language, `describeError`'s sentence and its way out: the footer
   * says it where it offers no retry. Always set by the hook, optional like {@link canRetry}.
   */
  describeRefusal?: (error: Error) => string
  fit: InlineRows
  /** While `loadMore` opens fullscreen, its button says "Show all". */
  footerLabels: { loadMore: string } | undefined
}

/** What a paged list reads: the feed, its arguments and how its answer reads. */
export interface PagedViewOptions<TItem, TData> {
  initialData: TData | null | undefined
  key: ReadonlyArray<unknown>
  tool: string
  args: Record<string, unknown>
  /** The rows a page asks for (`maxResults`). */
  pageSize: number
  ready: boolean
  selectItems: (data: TData) => TItem[]
  selectTotal: (data: TData) => number
}

/** The rows a page leaves: its own, the list's so far with it, page 0's total, the page's size. */
interface PageRows {
  readonly page: number
  readonly all: number
  readonly total: number
  readonly pageSize: number
  /** A page after page 0. */
  readonly later: boolean
}

/** The paging arguments of a feed beyond the list's and `maxResults`. */
type PageArgs = Readonly<Record<string, unknown>>

/** How a feed pages: what page 0 asks, and what the page after `page` asks (null: none follows). */
export interface Paging<TData> {
  readonly page0: PageArgs
  next(page: TData, rows: PageRows): PageArgs | null
}

/** Page 0 of the list: its read, the page on screen and whether it is this filter's. */
interface FirstPage<TData> {
  read: ViewDataResult<TData>
  argsKey: string
  /** This filter's page 0, none while the previous filter's stands in for it. */
  fetched: TData | null
  /** The page 0 on screen. */
  shown: TData | null
  stale: boolean
}

/**
 * The pages read after page 0 on screen, tagged with a reset generation: an
 * A→B→A filter round-trip must not append a page of the list before. State,
 * not a ref, keeps the reset replay-safe.
 */
interface LaterPages<TItem> {
  gen: number
  items: TItem[]
  /** What the next page asks, after the last page read; undefined before the first of them. */
  next: PageArgs | null | undefined
  error: Error | null
}

function useFirstPage<TItem, TData>(
  opts: PagedViewOptions<TItem, TData>,
  paging: Paging<TData>,
): FirstPage<TData> {
  const { initialData, key, tool, args, pageSize, ready } = opts
  const argsKey = JSON.stringify(args)
  const { scope, placeholderData } = useSameListPlaceholder<TData>(key)
  const read = useViewData<TData>(
    initialData,
    [...key, argsKey, "page0"],
    tool,
    { ...args, ...paging.page0, maxResults: pageSize },
    ready,
    { placeholderData },
  )
  const fetched = read.isPlaceholderData ? null : read.data
  const shown = useShownPage(read.data, scope, read.error !== null)
  return { read, argsKey, fetched, shown, stale: !fetched && !!shown }
}

const errorOf = (error: unknown) => (error instanceof Error ? error : new Error(String(error)))

/** What the page after page 0 on screen asks: none without one. */
function firstNextOf<TItem, TData>(
  opts: PagedViewOptions<TItem, TData>,
  paging: Paging<TData>,
  shown: TData | null,
  baseItems: readonly TItem[],
): PageArgs | null {
  if (!shown) return null
  const rows = baseItems.length
  const total = opts.selectTotal(shown)
  return paging.next(shown, { page: rows, all: rows, total, pageSize: opts.pageSize, later: false })
}

/** The pages after page 0, each read with what the page before names (Load more). */
function useLaterPages<TItem, TData>(
  opts: PagedViewOptions<TItem, TData>,
  paging: Paging<TData>,
  first: FirstPage<TData>,
  baseItems: readonly TItem[],
) {
  const { tool, args, pageSize, selectItems, selectTotal } = opts
  const { callTool } = useViewHost()
  const [pages, setPages] = useState<LaterPages<TItem>>({
    gen: 0,
    items: [],
    next: undefined,
    error: null,
  })
  const [loadingMore, setLoadingMore] = useState(false)
  // A page 0 read anew starts the list over: the pages after it went on from the one before.
  const reset = () =>
    setPages((prev) => ({ gen: prev.gen + 1, items: [], next: undefined, error: null }))
  useResetOnChange(first.argsKey, reset)
  useResetOnChange(first.shown, reset)
  const firstNext = firstNextOf(opts, paging, first.shown, baseItems)
  const next = pages.next === undefined ? firstNext : pages.next
  const { gen } = pages
  const settle = useCallback(
    (change: (shown: LaterPages<TItem>) => LaterPages<TItem>) =>
      setPages((shown) => (shown.gen === gen ? change(shown) : shown)),
    [gen],
  )
  const total = first.shown ? selectTotal(first.shown) : 0
  const fetchNext = useCallback(() => {
    if (!first.fetched || loadingMore || next === null) return
    setLoadingMore(true)
    settle((shown) => ({ ...shown, error: null }))
    void callTool(tool, { ...args, ...next, maxResults: pageSize })
      .then((result) => {
        const data = decodeToolResult<TData>(result)
        const pageItems = selectItems(data)
        settle((shown) => {
          const all = baseItems.length + shown.items.length + pageItems.length
          const rows = { page: pageItems.length, all, total, pageSize, later: true }
          return { ...shown, items: [...shown.items, ...pageItems], next: paging.next(data, rows) }
        })
      })
      .catch((error: unknown) => settle((shown) => ({ ...shown, error: errorOf(error) })))
      .finally(() => setLoadingMore(false))
  }, [
    first.fetched,
    loadingMore,
    next,
    settle,
    callTool,
    tool,
    args,
    pageSize,
    selectItems,
    total,
    baseItems.length,
    paging,
  ])
  return { pages, next, loadingMore, fetchNext }
}

/** The paged list `opts` names, page by page as `paging` asks. */
export function usePagedRows<TItem, TData>(
  opts: PagedViewOptions<TItem, TData>,
  paging: Paging<TData>,
): PagedViewData<TItem, TData> {
  const { pageSize, ready, selectItems, selectTotal } = opts
  const describeRefusal = useDescribeRefusal()
  const first = useFirstPage(opts, paging)
  const { shown, read } = first
  const baseItems = useMemo(() => (shown ? selectItems(shown) : []), [shown, selectItems])
  const later = useLaterPages(opts, paging, first, baseItems)
  const items = useMemo(() => [...baseItems, ...later.pages.items], [baseItems, later.pages.items])
  // The previous result belongs to another filter: no next page of it.
  const hasMore = !first.stale && later.next !== null
  const head = useInlineHead({
    items,
    hasMore,
    fetchNext: later.fetchNext,
    pageSize,
    resetKey: first.argsKey,
  })
  return {
    fit: head.fit,
    footerLabels: head.footerLabels,
    items: head.items,
    firstPage: shown,
    total: shown ? selectTotal(shown) : 0,
    stale: first.stale,
    hasMore: head.hasMore,
    loadMore: head.loadMore,
    loading: !shown && ready && read.error === null,
    refreshing: !!shown && read.isFetching,
    loadingMore: later.loadingMore,
    // Over rows on screen the first failed attempt unconfirms them; without rows the guard waits out retries.
    error: footerFailure(read.error ?? (shown ? read.failureReason : null), shown !== null),
    retry: read.refetch,
    loadMoreError: footerFailure(later.pages.error, true),
    canRetry,
    describeRefusal,
  }
}
