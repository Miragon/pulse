/**
 * What the paged lists of a view share, the offset's (`usePagedViewData`) and the cursor's
 * (`useCursorViewData`): page 0 kept on screen while the same list reads anew, the last page shown
 * through a failure, a failure as the footer says it, and the inline head of the rows that fit the
 * host's height (#396).
 */

import { useCallback, useMemo, useState } from "react"
import { useLocale } from "@miragon/pulse-ui"
import { describeError, isPermanentError, isSessionEnded } from "./describe-error.js"
import { useInlineBudget } from "./inline-budget.js"
import { useInlineRows, type InlineRows } from "./inline-fit.js"
import { kitLabels } from "./kit-labels.js"
import type { ViewDataOptions } from "./tool-query.js"
import { useViewHost } from "./view-host.js"

type PlaceholderOf<TData> = ViewDataOptions<TData>["placeholderData"]

/**
 * Keep-previous-data for page 0: without it the loading guard would unmount
 * the list and its search box on every round-trip. Same list (`scope`) only,
 * so another engine never shows the previous list's rows.
 */
export function useSameListPlaceholder<TData>(key: ReadonlyArray<unknown>): {
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
export function useShownPage<TData>(
  data: TData | null,
  scope: string,
  failed: boolean,
): TData | null {
  const [shown, setShown] = useState<{ scope: string; data: TData } | null>(null)
  if (data && (shown?.data !== data || shown.scope !== scope)) setShown({ scope, data })
  if (data) return data
  return failed && shown?.scope === scope ? shown.data : null
}

/** A refusal no retry changes in the host's language: `describeError`'s sentence and its way out. */
export function useDescribeRefusal(): (error: Error) => string {
  const { followUp, pageHints } = useViewHost()
  const locale = useLocale()
  return useCallback(
    (error: Error) => {
      const described = describeError(error, locale, { followUp, pageHints })
      return `${described.title}. ${described.hint}`
    },
    [locale, followUp, pageHints],
  )
}

/**
 * A failure as the list says it: over rows on screen a page's ended session is its frame's to say,
 * once (`isSessionEnded`), so the footer shows no alert for it and the rows stay; without rows the
 * list's guard says it is missing.
 */
export function footerFailure(error: Error | null, overRows: boolean): Error | null {
  return error && overRows && isSessionEnded(error) ? null : error
}

/** A retry may change a failure, unless the server refuses for good (`isPermanentError`). */
export function canRetry(error: Error): boolean {
  return !isPermanentError(error)
}

/** Inline, the rows that fit the budget (#396); more is fullscreen, else the next rows in place. */
export function useInlineHead<TItem>(opts: {
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
