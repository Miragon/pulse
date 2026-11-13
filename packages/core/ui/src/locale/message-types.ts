/**
 * The shapes of the kit's message catalogs (see `ui-messages.ts`).
 * Types only, kept apart from the catalogs so `messages-en.ts` /
 * `messages-de.ts` can implement them without an import cycle.
 */

/** Strings shared by several components. */
export interface CommonMessages {
  /** Accessible name of the close button in dialogs and sheets. */
  close: string
  /** Retry action of error states. */
  retry: string
  /** Summary of a technical-details disclosure. */
  details: string
  /** Accessible name of a toast's close button. */
  dismiss: string
  /**
   * @deprecated No longer rendered: the toast region is a plain live region
   * with fixed attributes and takes no name. Kept so a catalog that sets it
   * still type-checks.
   */
  notifications: string
  /** Title of a widget's error state when its data could not be loaded. */
  loadFailed: string
  /** The line under {@link CommonMessages.loadFailed}: what you can do (a retry follows). */
  loadFailedHint: string
}

/** Strings of `ListFooter`. */
export interface ListFooterMessages {
  /** The honest count line, e.g. "Showing 8 of 42 tasks". Numbers arrive pre-formatted. */
  showing: (params: { shown: string; total: string; noun: string }) => string
  /** Plural noun used when the caller passes none. */
  defaultNoun: string
  loadMore: string
  loadingMore: string
  /** Status while a new first page is in flight over the rows on screen. */
  updating: string
  /**
   * Status at zero rows, for screen readers only (the caller's empty state is
   * what you see): a search that finds nothing is announced like any count.
   */
  noResults: string
  /** Title when a new first page failed and the previous rows stay on screen. */
  refreshFailed: string
  /** The line under {@link ListFooterMessages.refreshFailed}: what you see and can do. */
  refreshFailedHint: string
  /**
   * The line under {@link ListFooterMessages.refreshFailed} for a failure no retry changes: what
   * you see, never "try again"; the caller's reason follows it.
   */
  refreshFailedFinalHint: string
  /** Title when loading the next page failed. */
  loadMoreFailed: string
  /** The line under {@link ListFooterMessages.loadMoreFailed}: what you see and can do. */
  loadMoreFailedHint: string
  /** {@link ListFooterMessages.refreshFailedFinalHint}'s counterpart under the load-more failure. */
  loadMoreFailedFinalHint: string
}

/** Strings of `FilterBar`. */
export interface FilterBarMessages {
  /** Placeholder of the search input. */
  searchPlaceholder: string
  /** Accessible name of the search input (a placeholder is no label). */
  searchLabel: string
  /** Accessible name of the chip group. */
  chipsLabel: string
}

/** Strings of `SearchField`. */
export interface SearchFieldMessages {
  /** Accessible name of the search input (a placeholder is no label). */
  label: string
  /** Placeholder of the search input. */
  placeholder: string
  /** Accessible name of the button that empties the field. */
  clear: string
}

/** One locale's complete kit catalog. */
export interface UiMessages {
  common: CommonMessages
  listFooter: ListFooterMessages
  filterBar: FilterBarMessages
  searchField: SearchFieldMessages
  pills: { live: string }
}
