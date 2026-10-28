import type { ReactNode } from "react"
import { cn, TONE_DOT } from "@miragon/mcp-toolkit-ui"
import { RowsBudgeted } from "./inline-budget.js"
import type { PagedViewData } from "./use-paged-view-data.js"

/**
 * Marks PREVIOUS-result rows with an edge bar, not a dimming: faded rows push
 * muted text under 4.5:1. The footer says in words what the bar marks, so old
 * rows never read as the new search's answer.
 */
export function PagedRows<TItem, TData>({
  paged,
  className,
  children,
}: {
  paged: PagedViewData<TItem, TData>
  className?: string
  children: ReactNode
}) {
  const tone = paged.refreshing ? "info" : "warning"
  // The wrapper's children are the rows when no table inside names its body.
  const { attachFallback } = paged.fit
  return (
    <div
      ref={attachFallback}
      aria-busy={paged.refreshing}
      data-stale={paged.stale || undefined}
      className={cn("relative", className)}
    >
      {paged.stale && (
        <span
          aria-hidden="true"
          data-tone={tone}
          className={cn(
            "pointer-events-none absolute inset-y-0 -left-2 z-10 w-0.5 rounded-full",
            TONE_DOT[tone],
          )}
        />
      )}
      <RowsBudgeted rows={paged.fit}>{children}</RowsBudgeted>
    </div>
  )
}
