import { useEffect, useRef } from "react"
import { cn } from "../lib/utils.js"
import { Button } from "../primitives/button.js"
import { useUiLocale, useUiMessages } from "../locale/locale-provider.js"
import type { CountNoun, ListFooterMessages } from "../locale/message-types.js"
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
  /**
   * The noun for the count: a word (`"instances"`), or a function that puts it in the number the
   * formatted total asks for (`"1 instance"`, `"2 instances"`). Default: the locale's word for rows.
   */
  noun?: CountNoun
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
 * The mark of a row that continues the one above it (an error under its row), widget-shell's
 * `FIT_CONTINUES_ROW` as the DOM carries it: such a row is no item of the list. pulse-ui is a leaf,
 * so widget-shell's `src/ui/paged-list-footer.test.tsx` holds the two spellings equal.
 */
const CONTINUES_ROW = "data-inline-fit-continues"

/**
 * The item rows of the table body the footer counts: the last body before it in its list, never a
 * skeleton, without the rows that continue the one above them, so the index of an item is its row.
 */
function rowsBefore(footer: HTMLElement): HTMLElement[] {
  let scope = footer.parentElement
  for (let depth = 0; scope !== null && depth < 4; depth += 1) {
    const bodies = Array.from(scope.querySelectorAll<HTMLElement>("tbody")).filter(
      (body) =>
        body.getAttribute("aria-hidden") !== "true" &&
        (body.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    )
    const body = bodies.at(-1)
    if (body) {
      return Array.from(body.querySelectorAll<HTMLElement>(`:scope > tr:not([${CONTINUES_ROW}])`))
    }
    scope = scope.parentElement
  }
  return []
}

/**
 * Focuses `target` if it takes focus there (shown, focusable: a tabindex, or natively, as a button
 * is); says whether it did. A row without a tabindex opens nothing and takes no focus.
 */
function focused(target: HTMLElement | null | undefined): boolean {
  if (!target?.isConnected || (target.tabIndex < 0 && !target.hasAttribute("tabindex"))) {
    return false
  }
  target.focus()
  return document.activeElement === target
}

/**
 * After "Load more", focus goes where the reader goes on: to the first new row, if it takes focus
 * (a row that opens is one), else to the button while there is a next page, else to the status
 * line, which says the new count. Never where focus left the footer meanwhile: only from the
 * footer (its button, which turns disabled and drops focus while the page loads, or a failure's
 * retry beside it) or from nowhere. A new search or filter, or rows that went stale, cancel it.
 */
function useFocusAfterLoadMore(shown: number, counted: boolean, refreshing: boolean) {
  const rootRef = useRef<HTMLDivElement>(null)
  const statusRef = useRef<HTMLParagraphElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // The page in flight or the rows stale: what changes the count is no page of this list.
  const settled = counted && !refreshing
  /** The rows on screen when Load more was asked, until its page is. */
  const asked = useRef<number | null>(null)
  useEffect(() => {
    const before = asked.current
    if (before === null || shown === before) return
    asked.current = null
    const footer = rootRef.current
    if (shown < before || !settled || !footer) return
    const list = footer.closest<HTMLElement>("[data-slot='paged-list-footer']") ?? footer
    const active = document.activeElement
    if (active !== null && active !== document.body && !list.contains(active)) return
    // After the rows' own effects: a table marks a new row focusable once it is in the DOM.
    const timer = setTimeout(() => {
      if (focused(rowsBefore(footer)[before])) return
      const button = buttonRef.current
      if (button && !button.disabled && focused(button)) return
      focused(statusRef.current)
    }, 0)
    return () => clearTimeout(timer)
  }, [shown, settled])
  const ask = () => {
    asked.current = shown
  }
  return { rootRef, statusRef, buttonRef, ask }
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
 * it (a screen reader stays silent then). After "Load more" focus moves on to
 * the first new row where it takes focus, else stays on the button while there
 * is a next page, else goes to the status line once the button is gone (the
 * last page), never to the page's body. Text and number format follow the
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
  const { rootRef, statusRef, buttonRef, ask } = useFocusAfterLoadMore(shown, counted, refreshing)
  // Without a live region of its own there is nothing to keep mounted.
  if (!visible && !announce) return null
  return (
    <div
      ref={rootRef}
      data-slot="list-footer"
      // The same element tree in both states, so React keeps the live region.
      className={visible ? cn(FOOTER_CLASS, className) : "sr-only"}
    >
      <p
        ref={statusRef}
        role={announce ? "status" : undefined}
        data-slot="list-footer-status"
        // Focus lands here after the last page, when the button that had it is gone.
        tabIndex={-1}
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
          ref={buttonRef}
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            ask()
            onLoadMore()
          }}
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
  noun: CountNoun | undefined
  counted: boolean
  refreshing: boolean
  empty: boolean
}) {
  const locale = useUiLocale()
  const totalText = formatCountIn(total, locale)
  const word = noun ?? messages.defaultNoun
  return (
    <>
      {empty && <span>{messages.noResults}</span>}
      {counted && (
        <span>
          {messages.showing({
            shown: formatCountIn(shown, locale),
            total: totalText,
            noun: typeof word === "function" ? word(totalText) : word,
          })}
        </span>
      )}
      {refreshing && <span data-slot="list-footer-updating">{messages.updating}</span>}
    </>
  )
}
