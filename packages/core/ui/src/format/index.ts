// `@miragon/pulse-ui/format`: the one set of formatters every Pulse UI renders dates, times,
// durations, numbers, counts and ids with, framework-free (no React, no DOM, no import outside
// this folder: `ui-foundation-entries-import-nothing` in .dependency-cruiser.cjs), so a UI on
// another framework (the VS Code webview on Preact, the extension's core) shows them as the MCP
// views do. They render in the locale set once with `setFormatLocale` (the runtime's own until
// then; a test resets it with `setFormatLocale(undefined)`). The root entry exports the same names.
export {
  setFormatLocale,
  getFormatLocale,
  subscribeFormatLocale,
  type FormatLocale,
} from "./locale.js"
export {
  formatTimestamp,
  formatDate,
  formatTime,
  formatClock,
  formatInstant,
  formatRelativeTime,
  type TimeOptions,
  type ClockOptions,
} from "./dates.js"
export {
  formatNumber,
  formatCount,
  formatCompactCount,
  formatPercent,
  formatPercentPoints,
  formatPeriod,
  type Count,
  type PercentFormatOptions,
} from "./numbers.js"
export { formatDuration } from "./duration.js"
export { truncate, shortId } from "./text.js"
