import type { UiMessages } from "./message-types.js"

/**
 * English catalog: the fallback for every locale the kit does not ship.
 * Sentence case, active voice, one "…" character for ellipses, no dashes as
 * connectors; guarded by `ui-messages.test.ts`.
 */
export const en: UiMessages = {
  common: {
    close: "Close",
    retry: "Try again",
    details: "Details",
    dismiss: "Close notification",
    notifications: "Notifications",
    loadFailed: "This content couldn't be loaded",
    loadFailedHint: "Try again. If it fails again, ask in the chat.",
    loading: "Loading…",
  },
  listFooter: {
    showing: ({ shown, total, noun }) => `Showing ${shown} of ${total} ${noun}`.trimEnd(),
    defaultNoun: "rows",
    loadMore: "Load more",
    loadingMore: "Loading…",
    updating: "Updating…",
    noResults: "No entries",
    refreshFailed: "Couldn't update the list",
    refreshFailedHint: "You're seeing the previous result. Try again in a moment.",
    refreshFailedFinalHint: "You're seeing the previous result.",
    loadMoreFailed: "Couldn't load more entries",
    loadMoreFailedHint: "The entries above are current. Try again in a moment.",
    loadMoreFailedFinalHint: "The entries above are current.",
  },
  filterBar: { searchPlaceholder: "Filter…", searchLabel: "Filter", chipsLabel: "Filters" },
  searchField: { label: "Search", placeholder: "Search…", clear: "Clear search" },
  dataTable: {
    selectAll: "Select all shown rows",
    resizeColumn: ({ column }) => `Resize column ${column}`,
    columnWidth: ({ width }) => `${width} pixels`,
    columnMenu: ({ column }) => `Width of column ${column}`,
    fitColumn: "Fit to content",
    widerColumn: "Wider",
    narrowerColumn: "Narrower",
    resetColumns: "Reset all widths",
  },
  viewBar: { back: "Back", readOnly: "Read-only", writable: "Writable" },
  copyableId: {
    copy: ({ label }) => `Copy ${label}`,
    copied: ({ label }) => `Copied ${label}`,
    done: "Copied",
  },
  conditionChip: {
    edit: ({ label }) => `Edit filter ${label}`,
    remove: ({ label }) => `Remove filter ${label}`,
  },
  stateLabel: {
    running: "Running",
    suspended: "Suspended",
    completed: "Completed",
    cancelled: "Cancelled",
    ended: "Ended",
    incident: "Incident",
  },
  pills: { live: "Live" },
}
