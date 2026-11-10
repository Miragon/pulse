import { useUiMessages } from "../locale/locale-provider.js"
import type { ListFooterMessages } from "../locale/message-types.js"
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
}

export interface PagedListFooterProps {
  /** The paged list's state. */
  paged: PagedListState
  /** Plural noun for "Showing X of Y {noun}". Default: the locale's word for rows. */
  noun?: string
  /** Override strings of the active catalog's `listFooter` section. */
  labels?: Partial<ListFooterMessages>
  /** Retry button label of both error lines. Default: the locale's "Try again". */
  retryLabel?: string
}

/** The raw reason of a failure, for the "Details" disclosure (never the sentence). */
function rawReason(error: Error): string {
  return error.message || error.name
}

/**
 * The tail of a paged list: its failures and the honest {@link ListFooter}.
 * Two failures stay apart because their retries differ: a failed first page
 * over the rows still on screen ("You're seeing the previous result", its
 * retry re-runs page 0) and a failed load-more ("The entries above are
 * current", its retry fetches the next offset), each offered unless
 * `paged.canRetry` says no retry changes the failure. Each is an inline
 * `ErrorState` (role="alert") with the raw reason under "Details". The
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
    paged.canRetry?.(error) === false ? undefined : retry
  return (
    <div data-slot="paged-list-footer" className="flex flex-col gap-2">
      {refreshError && (
        <ErrorState
          variant="inline"
          tone="warning"
          title={L.refreshFailed}
          description={L.refreshFailedHint}
          details={rawReason(refreshError)}
          onRetry={retryOf(refreshError, paged.retry)}
          retryLabel={retryLabel}
        />
      )}
      {paged.loadMoreError && (
        <ErrorState
          variant="inline"
          title={L.loadMoreFailed}
          description={L.loadMoreFailedHint}
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
