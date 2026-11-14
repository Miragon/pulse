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
  /** What a `LoadingState` says while its content loads. */
  loading: string
}

/**
 * A list's noun for its count line: a word, or the word in the number the formatted total asks
 * for ("1 incident", "2 incidents").
 */
export type CountNoun = string | ((total: string) => string)

/** Strings of `ListFooter`. */
export interface ListFooterMessages {
  /** The honest count line, e.g. "Showing 8 of 42 tasks". Numbers arrive pre-formatted. */
  showing: (params: { shown: string; total: string; noun: string }) => string
  /** The noun used when the caller passes none, in the number the total asks for. */
  defaultNoun: CountNoun
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

/** Strings of `DataTable`: its selection column and the sizing of its columns. */
export interface DataTableMessages {
  /** Accessible name of the selection column's box in the head (every row shown). */
  selectAll: string
  /** Accessible name of a column's sizing grip, e.g. "Resize column Process". */
  resizeColumn: (params: { column: string }) => string
  /** A column's width in words, the grip's value. The number arrives pre-formatted. */
  columnWidth: (params: { width: string }) => string
  /** Accessible name of a column's menu button, the single-pointer way to size it. */
  columnMenu: (params: { column: string }) => string
  /** Menu entry: the column takes its content's width. */
  fitColumn: string
  /** Menu entry: the column grows by a step. */
  widerColumn: string
  /** Menu entry: the column shrinks by a step. */
  narrowerColumn: string
  /** Menu entry: every column of the table takes its content's width again. */
  resetColumns: string
}

/** Strings of `ViewBar`: its back button and its access chip. */
export interface ViewBarMessages {
  /** Accessible name of the back button. */
  back: string
  /** The access chip of a view that only reads from the engine. */
  readOnly: string
  /** The access chip of a view that may write to the engine. */
  writable: string
}

/** Strings of `CopyableId`. */
export interface CopyableIdMessages {
  /** The copy button's name, e.g. "Copy instance ID". */
  copy: (params: { label: string }) => string
  /** The copy button's name for a moment after a copy, e.g. "Copied instance ID". */
  copied: (params: { label: string }) => string
  /** What the live region says once the copy is done. */
  done: string
}

/** Strings of `ConditionChip`: its two buttons, each naming the chip. */
export interface ConditionChipMessages {
  /** The chip's label as a button that edits it, e.g. "Edit filter amount > 100". */
  edit: (params: { label: string }) => string
  /** The chip's remove button, e.g. "Remove filter amount > 100". */
  remove: (params: { label: string }) => string
}

/**
 * The words of `StateLabel`: one word per state of an instance or a step, in every Pulse UI
 * (`PRODUCT_GLOSSARY` holds the synonyms off).
 */
export interface StateLabelMessages {
  running: string
  suspended: string
  completed: string
  cancelled: string
  /** Ended, where the view does not know whether it completed or was cancelled. */
  ended: string
  incident: string
}

/**
 * The words of a count where the screen shows a sign: a screen reader hears "at least 2,000" for
 * `≥ 2,000` and "count unknown" for `—` (`TabCount`, `SegmentedControl`).
 */
export interface CountMessages {
  /** A lower bound a capped read vouches for, e.g. "at least 2,000". The number arrives formatted. */
  atLeast: (params: { count: string }) => string
  /** A count no read gave (the screen shows "—"). */
  unknown: string
}

/** One locale's complete kit catalog. */
export interface UiMessages {
  common: CommonMessages
  listFooter: ListFooterMessages
  filterBar: FilterBarMessages
  searchField: SearchFieldMessages
  dataTable: DataTableMessages
  viewBar: ViewBarMessages
  copyableId: CopyableIdMessages
  conditionChip: ConditionChipMessages
  stateLabel: StateLabelMessages
  count: CountMessages
  pills: { live: string }
}
