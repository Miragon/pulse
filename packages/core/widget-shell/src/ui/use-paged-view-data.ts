import { useCallback, useMemo, useState } from "react"
import { parseToolResult, useCallTool, useLocale } from "@miragon/mcp-toolkit-ui"
import { useViewData, type UseViewDataOptions } from "@miragon/mcp-toolkit-ui/hooks"
import { useInlineBudget } from "./inline-budget.js"
import { useInlineRows, type InlineRows } from "./inline-fit.js"
import { kitLabels } from "./kit-labels.js"

/**
 * Appended pages, tagged with a reset generation: an A→B→A filter round-trip
 * must not append a stale-offset page. State, not a ref, keeps the reset replay-safe.
 */
interface PagedState<TItem> {
  gen: number
  items: TItem[]
  /** A page shorter than pageSize means the server is out of rows, whatever `total` claims. */
  exhausted: boolean
  error: Error | null
}

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
   * attempt, so the list never presents them as current through the backoff.
   */
  error: Error | null
  /** A new read at once, also during the client's retry backoff. */
  retry: () => void
  loadMoreError: Error | null
  fit: InlineRows
  /** While `loadMore` opens fullscreen, its button says "Show all". */
  footerLabels: { loadMore: string } | undefined
}

type PlaceholderOf<TData> = UseViewDataOptions<TData>["placeholderData"]

/**
 * Keep-previous-data for page 0: without it the loading guard would unmount
 * the list and its search box on every round-trip. Same list (`scope`) only,
 * so another engine never shows the previous list's rows.
 */
function useSameListPlaceholder<TData>(key: ReadonlyArray<unknown>): {
  scope: string
  placeholderData: PlaceholderOf<TData>
} {
  const scope = JSON.stringify(key)
  const depth = key.length
  const placeholderData = useCallback(
    (previous: TData | undefined, previousQuery?: { queryKey: readonly unknown[] }) =>
      previousQuery && JSON.stringify(previousQuery.queryKey.slice(0, depth)) === scope
        ? previous
        : undefined,
    [scope, depth],
  )
  return { scope, placeholderData: placeholderData as PlaceholderOf<TData> }
}

/**
 * TanStack drops a placeholder once retries ran out, but the failure line says
 * "you're seeing the previous result", so the last shown page bridges it.
 */
function useShownPage<TData>(data: TData | null, scope: string, failed: boolean): TData | null {
  const [shown, setShown] = useState<{ scope: string; data: TData } | null>(null)
  if (data && (shown?.data !== data || shown.scope !== scope)) setShown({ scope, data })
  if (data) return data
  return failed && shown?.scope === scope ? shown.data : null
}

/**
 * Offset-paginated sibling of the toolkit's `useViewData`; page 0 is seeded so
 * a write's invalidation refetches a standalone list too. The feed must return
 * the full filtered `total`. Button-driven, not infinite scroll.
 */
export function usePagedViewData<TItem, TData>(opts: {
  initialData: TData | null | undefined
  key: ReadonlyArray<unknown>
  tool: string
  args: Record<string, unknown>
  pageSize: number
  ready: boolean
  selectItems: (data: TData) => TItem[]
  selectTotal: (data: TData) => number
}): PagedViewData<TItem, TData> {
  const { initialData, key, tool, args, pageSize, ready, selectItems, selectTotal } = opts
  const callTool = useCallTool()
  const argsKey = JSON.stringify(args)
  const { scope, placeholderData } = useSameListPlaceholder<TData>(key)

  const page0 = useViewData<TData>(
    initialData,
    [...key, argsKey, "page0"],
    tool,
    { ...args, firstResult: 0, maxResults: pageSize },
    ready,
    { initialDataMode: "seed", placeholderData },
  )
  // `fetched` is THIS filter's page 0; `first` is the page on screen.
  const fetched = page0.isPlaceholderData ? null : page0.data
  const first = useShownPage(page0.data, scope, page0.error !== null)
  const stale = !fetched && !!first

  const [pages, setPages] = useState<PagedState<TItem>>({
    gen: 0,
    items: [],
    exhausted: false,
    error: null,
  })
  const [loadingMore, setLoadingMore] = useState(false)

  // A page-0 refetch shifts rows, so appended pages would duplicate or skip: drop them.
  const [prevReset, setPrevReset] = useState(argsKey)
  const [prevFirst, setPrevFirst] = useState<TData | null>(first)
  if (argsKey !== prevReset || first !== prevFirst) {
    setPrevReset(argsKey)
    setPrevFirst(first)
    setPages((prev) => ({ gen: prev.gen + 1, items: [], exhausted: false, error: null }))
  }

  const baseItems = useMemo(() => (first ? selectItems(first) : []), [first, selectItems])
  const items = useMemo(() => [...baseItems, ...pages.items], [baseItems, pages.items])
  const total = first ? selectTotal(first) : 0
  // The previous result belongs to another filter: no next page of it.
  const hasMore = !stale && !pages.exhausted && items.length < total

  const gen = pages.gen
  const fetchNext = useCallback(() => {
    if (!fetched || loadingMore || !callTool) return
    setLoadingMore(true)
    setPages((prev) => (prev.gen === gen ? { ...prev, error: null } : prev))
    void callTool(tool, { ...args, firstResult: items.length, maxResults: pageSize })
      .then((res) => {
        const data = parseToolResult<TData>(res)
        const pageItems = selectItems(data)
        setPages((prev) =>
          prev.gen === gen
            ? {
                ...prev,
                items: [...prev.items, ...pageItems],
                exhausted: prev.exhausted || pageItems.length < pageSize,
              }
            : prev,
        )
      })
      .catch((err: unknown) => {
        setPages((prev) =>
          prev.gen === gen
            ? { ...prev, error: err instanceof Error ? err : new Error(String(err)) }
            : prev,
        )
      })
      .finally(() => setLoadingMore(false))
  }, [fetched, loadingMore, callTool, tool, args, items.length, pageSize, selectItems, gen])

  const head = useInlineHead({ items, hasMore, fetchNext, pageSize, resetKey: argsKey })

  return {
    fit: head.fit,
    footerLabels: head.footerLabels,
    items: head.items,
    firstPage: first,
    total,
    stale,
    hasMore: head.hasMore,
    loadMore: head.loadMore,
    loading: !first && ready && page0.error === null,
    refreshing: !!first && page0.isFetching,
    loadingMore,
    // Over rows on screen the first failed attempt unconfirms them; without rows the guard waits out retries.
    error: page0.error ?? (first ? page0.failureReason : null),
    retry: page0.refetch,
    loadMoreError: pages.error,
  }
}

/** Inline, the rows that fit the budget (#396); more is fullscreen, else the next rows in place. */
function useInlineHead<TItem>(opts: {
  items: TItem[]
  hasMore: boolean
  fetchNext: () => void
  pageSize: number
  resetKey: string
}): {
  items: TItem[]
  hasMore: boolean
  loadMore: () => void
  fit: InlineRows
  footerLabels: { loadMore: string } | undefined
} {
  const { items, hasMore, fetchNext, pageSize, resetKey } = opts
  const { expand } = useInlineBudget()
  const labels = kitLabels(useLocale())
  const fit = useInlineRows(items.length, { resetKey, contentKey: items })
  const { cap, step, reveal } = fit
  const capped = cap !== null && items.length > cap
  const shown = useMemo(() => (capped ? items.slice(0, cap) : items), [capped, items, cap])
  const opensFullscreen = cap !== null && expand !== null
  const loadMore = useCallback(() => {
    if (opensFullscreen) return expand?.()
    if (capped) return reveal(step)
    if (cap !== null) reveal(items.length + pageSize - cap)
    fetchNext()
  }, [opensFullscreen, expand, capped, reveal, step, cap, items.length, pageSize, fetchNext])
  return {
    items: shown,
    hasMore: capped || hasMore,
    loadMore,
    fit,
    footerLabels: opensFullscreen ? { loadMore: labels.showAll } : undefined,
  }
}
