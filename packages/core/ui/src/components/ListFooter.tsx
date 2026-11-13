import { cn } from "../lib/utils.js"
import { Button } from "../primitives/button.js"
import { useUiLocale, useUiMessages } from "../locale/locale-provider.js"
import type { ListFooterMessages } from "../locale/message-types.js"
import { formatCountIn } from "../locale/ui-messages.js"

export interface ListFooterProps {
  /** How many rows are currently rendered. */
  shown: number
  /** The total number of rows available. */
  total: number
  /** Whether more rows can be loaded. */
  hasMore: boolean
  /** Disables the button and shows a loading label while a fetch is in flight. */
  loadingMore?: boolean
  /** Called when the user asks for the next page. */
  onLoadMore: () => void
  /** Plural noun for the count, e.g. `"instances"`. Default: the locale's word for rows. */
  noun?: string
  /**
   * A new first page is in flight while these rows stay on screen (a search,
   * a filter, a refetch): the status line adds a visible "Updating…".
   */
  refreshing?: boolean
  /**
   * The rows on screen are the PREVIOUS result (a changed search or filter is
   * in flight or failed): the count and "Load more" hide, so the old count
   * never reads as the new search's answer.
   */
  stale?: boolean
  /** Override strings of the active catalog's `listFooter` section. */
  labels?: Partial<ListFooterMessages>
  /**
   * Make the count line a polite live region (`role="status"`). Default
   * `true`. Set `false` only where the caller already announces the count in
   * a live region of its own, so a screen reader hears it once.
   */
  announce?: boolean
  className?: string
}

/**
 * Footer for a paginated list: an honest "Showing X of Y" total plus an
 * explicit "Load more" control. Deliberately not infinite scroll: the user
 * gets the total, a reachable footer, and control over fetching. The count
 * is a polite live region (`role="status"`), so a keyboard or screen-reader
 * user hears the new total after "Load more" or a filter change; while a
 * first page is in flight it also says "Updating…". With nothing to count and
 * nothing in flight it shows nothing, but the live region stays mounted
 * (visually hidden) and says "No entries": a search that finds nothing is
 * announced too, and the region is never re-created with its news already in
 * it (a screen reader stays silent then). Text and number format follow the
 * active locale (the nearest `LocaleProvider`, else English).
 */
export function ListFooter({
  shown,
  total,
  hasMore,
  loadingMore = false,
  onLoadMore,
  noun,
  refreshing = false,
  stale = false,
  labels,
  announce = true,
  className,
}: ListFooterProps) {
  const listFooter = { ...useUiMessages().listFooter, ...labels }
  const counted = total > 0 && !stale
  const visible = counted || refreshing
  // Without a live region of its own there is nothing to keep mounted.
  if (!visible && !announce) return null
  return (
    <div
      data-slot="list-footer"
      // The same element tree in both states, so React keeps the live region.
      className={visible ? cn(FOOTER_CLASS, className) : "sr-only"}
    >
      <p
        role={announce ? "status" : undefined}
        data-slot="list-footer-status"
        className="flex flex-wrap items-center gap-x-2"
      >
        <StatusLine
          messages={listFooter}
          shown={shown}
          total={total}
          noun={noun}
          counted={counted}
          refreshing={refreshing}
          // Zero rows, not a stale previous result (its failure the caller reports).
          empty={!visible && !stale}
        />
      </p>
      {counted && hasMore && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onLoadMore}
          disabled={loadingMore}
        >
          {loadingMore ? listFooter.loadingMore : listFooter.loadMore}
        </Button>
      )}
    </div>
  )
}

/** The cell's side padding, so the count lines up with the rows above it. */
const FOOTER_CLASS =
  "text-small text-muted-foreground px-cell flex items-center justify-between gap-3 py-1.5"

/** What the live region says: the count, "Updating…", or "No entries" at zero rows. */
function StatusLine({
  messages,
  shown,
  total,
  noun,
  counted,
  refreshing,
  empty,
}: {
  messages: ListFooterMessages
  shown: number
  total: number
  noun: string | undefined
  counted: boolean
  refreshing: boolean
  empty: boolean
}) {
  const locale = useUiLocale()
  return (
    <>
      {empty && <span>{messages.noResults}</span>}
      {counted && (
        <span>
          {messages.showing({
            shown: formatCountIn(shown, locale),
            total: formatCountIn(total, locale),
            noun: noun ?? messages.defaultNoun,
          })}
        </span>
      )}
      {refreshing && <span data-slot="list-footer-updating">{messages.updating}</span>}
    </>
  )
}
