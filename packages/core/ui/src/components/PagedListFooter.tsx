import { useUiMessages } from "../locale/locale-provider.js"
import type { CountNoun, ListFooterMessages } from "../locale/message-types.js"
import { ErrorState } from "./ErrorState.js"
import { ListFooter } from "./ListFooter.js"

/**
 * What {@link PagedListFooter} reads from a paged list: structural, so a
 * paged-query hook's result (`items`, `total`, `loadMore`, …) passes as is.
 */
export interface PagedListState {
  /** The rows on screen (all loaded pages); its length is the "shown" count. */
  items: readonly unknown[]
  /** The server's total for the rows on screen. */
  total: number
  /** Whether another page exists. */
  hasMore: boolean
  /** Fetch the next page (also the retry of a failed load-more). */
  loadMore: () => void
  /** A next page is in flight. */
  loadingMore?: boolean
  /** A first page is in flight while rows are on screen (a search, a filter, a refetch). */
  refreshing?: boolean
  /** The rows on screen are the previous result: a changed search or filter is in flight or failed. */
  stale?: boolean
  /**
   * The first page that is on screen, if any. A first-page {@link error} only
   * belongs in the footer while one is shown; without rows on screen it is
   * the load error the caller's loading guard renders.
   */
  firstPage?: unknown
  /** The first-page failure (see {@link firstPage}). */
  error?: Error | null
  /** Re-run the first page: the retry of {@link error}. */
  retry?: () => void
  /** The last load-more failure; {@link loadMore} retries it, the rows above stay current. */
  loadMoreError?: Error | null
  /**
   * Whether a retry can change a failure; false offers none for it (a refusal that holds until
   * someone changes a setting, say). Without it every failure offers its retry.
   */
  canRetry?: (error: Error) => boolean
  /**
   * What a failure no retry changes means and what to do, in the active locale, whole sentences:
   * said after what you see where {@link canRetry} says no, in place of "try again". This leaf
   * words no failure itself, so the caller brings it (widget-shell's paged lists, from
   * `describeError`); without it the line says only what you see. Catalog words only, never the
   * raw reason (`error.message`), which the footer shows under "Details": the kit's gate against a
   * raw error in a description cannot read a callback's words, so this is the caller's to keep.
   */
  describeRefusal?: (error: Error) => string
}

export interface PagedListFooterProps {
  /** The paged list's state. */
  paged: PagedListState
  /** The noun of "Showing X of Y {noun}", a word or one in the total's number ({@link ListFooter}). */
  noun?: CountNoun
  /** Override strings of the active catalog's `listFooter` section. */
  labels?: Partial<ListFooterMessages>
  /** Retry button label of both error lines. Default: the locale's "Try again". */
  retryLabel?: string
}

/** The raw reason of a failure, for the "Details" disclosure (never the sentence). */
function rawReason(error: Error): string {
  return error.message || error.name
}

/** Whether `paged` says no retry changes `error`. */
function isFinal(paged: PagedListState, error: Error): boolean {
  return paged.canRetry?.(error) === false
}

/**
 * The line under a failure: its `hint`, or for a refusal no retry changes what you see
 * (`finalHint`) and the caller's words for it, never "try again". It takes the error to ask
 * `canRetry` and `describeRefusal` about it, so the kit's raw-error gate, which flags every
 * error-named value in a description, would flag it in the JSX: the line is built before, out of
 * the gate's sight, and `PagedListFooter.test.tsx` holds what the gate cannot, that the raw reason
 * shows only under "Details".
 */
function failureLine(paged: PagedListState, error: Error, hint: string, finalHint: string): string {
  if (!isFinal(paged, error)) return hint
  return [finalHint, paged.describeRefusal?.(error)].filter(Boolean).join(" ")
}

/**
 * The tail of a paged list: its failures and the honest {@link ListFooter}.
 * Two failures stay apart because their retries differ: a failed first page
 * over the rows still on screen ("You're seeing the previous result", its
 * retry re-runs page 0) and a failed load-more ("The entries above are
 * current", its retry fetches the next offset), each offered unless
 * `paged.canRetry` says no retry changes the failure; then neither the button
 * nor the line says "try again", and `paged.describeRefusal` says why. Each is
 * an inline `ErrorState` (role="alert") with the raw reason under "Details". The
 * footer's count line is a polite live region that says "Updating…" while a
 * first page is in flight, hides the count while the rows are stale, and
 * stays mounted at zero rows ("No entries", visually hidden), so a search
 * that finds nothing is announced.
 */
export function PagedListFooter({ paged, noun, labels, retryLabel }: PagedListFooterProps) {
  const catalog = useUiMessages().listFooter
  const L = { ...catalog, ...labels }
  const refreshError = paged.firstPage != null ? (paged.error ?? null) : null
  const retryOf = (error: Error, retry: (() => void) | undefined) =>
    isFinal(paged, error) ? undefined : retry
  const refreshLine =
    refreshError && failureLine(paged, refreshError, L.refreshFailedHint, L.refreshFailedFinalHint)
  const loadMoreLine =
    paged.loadMoreError &&
    failureLine(paged, paged.loadMoreError, L.loadMoreFailedHint, L.loadMoreFailedFinalHint)
  return (
    <div data-slot="paged-list-footer" className="flex flex-col gap-2">
      {refreshError && (
        <ErrorState
          variant="inline"
          tone="warning"
          title={L.refreshFailed}
          description={refreshLine}
          details={rawReason(refreshError)}
          onRetry={retryOf(refreshError, paged.retry)}
          retryLabel={retryLabel}
        />
      )}
      {paged.loadMoreError && (
        <ErrorState
          variant="inline"
          title={L.loadMoreFailed}
          description={loadMoreLine}
          details={rawReason(paged.loadMoreError)}
          onRetry={retryOf(paged.loadMoreError, paged.loadMore)}
          retryLabel={retryLabel}
        />
      )}
      <ListFooter
        shown={paged.items.length}
        total={paged.total}
        hasMore={paged.hasMore}
        loadingMore={paged.loadingMore}
        onLoadMore={paged.loadMore}
        noun={noun}
        refreshing={paged.refreshing}
        stale={paged.stale}
        labels={labels}
      />
    </div>
  )
}
