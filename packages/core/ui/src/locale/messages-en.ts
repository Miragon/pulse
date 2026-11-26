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
    noValue: "no value",
  },
  listFooter: {
    showing: ({ shown, total, noun }) => `Showing ${shown} of ${total} ${noun}`.trimEnd(),
    defaultNoun: (total) => (total === "1" ? "row" : "rows"),
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
    rowOpens: "Enter opens the row.",
    rowOpensCopies: "Enter opens the row, Ctrl or Cmd+C copies its ID.",
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
  count: { atLeast: ({ count }) => `at least ${count}`, unknown: "count unknown" },
  freshness: { asOf: ({ time }) => `As of ${time}` },
  sectionState: {
    kept: "You're seeing the previous result.",
    sameFailure: "Not read, for the same reason as above.",
    sameFailureKept:
      "Not refreshed, for the same reason as above. You're seeing the previous result.",
  },
  pageError: {
    needsReauth: ({ connector }) => `Your sign-in to ${connector} has expired`,
    needsReauthHint: ({ connector, place }) =>
      `Reconnect to ${connector}${at(place)}, then try again.`,
    notConnected: ({ connector }) => `This page isn't connected to ${connector}`,
    notConnectedHint: ({ connector, place }) => `Set up ${connector}${at(place)}, then try again.`,
    selectionRequired: ({ connector }) =>
      `This page waits for you to choose its connection to ${connector}`,
    selectionRequiredHint: ({ connector }) =>
      `Choose the connection to ${connector} the page should use when you're asked, then try again.`,
    notDeclared: ({ connector }) => `This page isn't set up to use ${connector}`,
    notDeclaredHint: ({ connector }) =>
      `Only whoever published the page can set up its connection to ${connector}. Ask them.`,
    notAllowed: () => "This page may not call the tool it needs",
    notAllowedHint: () =>
      "A setting of the page or a policy of your organization blocks the call. Ask whoever published the page.",
    approvalRequired: () => "This read waits for your approval",
    approvalRequiredHint: ({ connector }) =>
      `Allow the page to use ${connector} when you're asked, then try again.`,
    unavailable: ({ connector }) => `${connector} doesn't answer`,
    unavailableHint: ({ connector }) =>
      `Try again in a moment. If it keeps failing, ask whoever runs ${connector}.`,
    toolError: ({ connector }) => `${connector} couldn't complete this read`,
    toolErrorHint: ({ connector }) =>
      `Try again. If it fails again, ask whoever runs ${connector}.`,
  },
  bpmn: {
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    fit: "Fit to viewport",
    drawFailed: "The diagram couldn't be drawn",
    drawFailedHint: "Open the model in your modeler to check it.",
    countRunning: ({ element, count }) =>
      `${element}: ${count} ${String(count) === "1" ? "instance" : "instances"} running`,
    countIncidents: ({ element, count }) =>
      `${element}: ${count} ${String(count) === "1" ? "incident" : "incidents"}`,
    countIncidentsInCalledInstances: ({ element, count }) =>
      `${element}: ${count} ${String(count) === "1" ? "incident" : "incidents"} in called instances`,
    legendLabel: "Legend",
    legendRunning: "waiting here",
    legendIncidents: "incident here",
    legendIncidentsInCalledInstances: "incident in a called instance",
  },
}

/** A place after a name, as the page passes it ("in claude.ai, …"); nothing without one. */
function at(place: string | undefined): string {
  return place ? ` ${place}` : ""
}
