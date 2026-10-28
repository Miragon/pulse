// Only what widget-shell adds to the toolkit (`toolkit-overlap.test.ts`).
// Profile option sets are zod-free, so safe for the UI bundle.
export { LANGUAGES, LOCALES, type LanguagePref, type Locale } from "../profile-constants.js"
export { createUseT, type T } from "./create-use-t.js"
export { DisplayModeProvider, WidgetShell, useHostDisplayMode } from "./widget-shell.js"
export { ViewDataState, LoadingStatus } from "./view-data-state.js"
export {
  describeError,
  classifyError,
  type DescribeErrorOptions,
  type DescribedError,
  type ErrorFacts,
  type ErrorKind,
  type ErrorSource,
} from "./describe-error.js"
export { Section } from "./section.js"
export {
  Th,
  Td,
  TableEmptyState,
  VersionChip,
  type ColumnSort,
  type EmptyVariant,
} from "./table.js"
export {
  ListTable,
  COLUMN_BREAKPOINTS,
  type ColumnBreakpoint,
  type ListTableColumn,
  type ListTableGroup,
} from "./list-table.js"
export { IdText, IdCell, shortId, copyText, ID_FULL_LENGTH } from "./id-text.js"
export { NamedId } from "./named-id.js"
export { countTone, severityTone } from "./count-tone.js"
export { ConfirmDialog, type ConfirmDialogProps, type ConfirmTarget } from "./confirm-dialog.js"
export { useActionFeedback, type ActionFeedback } from "./action-feedback.js"
export { KometMark, AppEmptyState, KOMET_MIN_SIZE } from "./brand-mark.js"
export { GenericKpiGridWidget, GenericDataTableWidget } from "./generic-widgets.js"
export { QueryFallback, TableSkeleton } from "./query-fallback.js"
export {
  formatDate,
  formatDuration,
  formatNumber,
  formatPercent,
  formatPercentPoints,
  formatPeriod,
  formatTime,
  formatTimestamp,
  truncate,
  type PercentFormatOptions,
} from "./format.js"
export {
  ViewMeta,
  formatLookback,
  formatViewMeta,
  VIEW_META_LABELS,
  type ViewMetaEngines,
  type ViewMetaLabels,
  type ViewMetaParts,
} from "./view-meta.js"
export { Icon, type LucideIcon } from "./icon.js"
export { RowCard } from "./row-card.js"
export { NativeSelect } from "./native-select.js"
export { SettingsCard, SettingsField, SettingsInput } from "./settings.js"
export { HostWidgetsProvider, useHostWidgets } from "./host-widgets.js"
export {
  SettingsPageWidget,
  ShellSettingsWidget,
  SHELL_SETTINGS_KEY,
  describeShellSettings,
} from "./shell-settings.js"
export { settingsLayout, filterLayoutToWidgets } from "./settings-layout.js"
export { shellWidgets } from "./shell-widgets.js"
export {
  SHELL_SAVE_SETTINGS,
  SHELL_SETTINGS_DATA,
  SHELL_SETTINGS_PAGE_WIDGET,
  SHELL_SETTINGS_WIDGET,
  SHELL_SHOW_SETTINGS,
  type ShellSettingsReadOnlyReason,
  type ShellSettingsView,
} from "../shell-settings-contract.js"
export { ProfileGate, type ProfileGateProps } from "./profile-gate.js"
export { LocalizedAppView } from "./localized-app-view.js"
export { AppShellProviders, type AppShellProvidersProps } from "./app-shell-providers.js"
export { ShellHostProvider, ViewHostBridge, useShellHost, type ShellHost } from "./shell-host.js"
export { HostDocument } from "./host-document.js"
export { declareServedFonts, SERVED_FONTS_STYLE_ID } from "./declare-served-fonts.js"
export { SERVED_FONT_FILES, SERVED_FONT_PATH, servedFontBaseUrl } from "../served-fonts.js"
export { SegmentedControl, type SegmentedControlOption } from "./segmented-control.js"
export { useDetailView } from "./use-detail-view.js"
export { viewRefreshState, type ViewRefreshState } from "./view-refresh-state.js"
export { LogText, LOG_TEXT_PREVIEW, TEXT_BLOCK_FRAME } from "./log-text.js"
export { AskAiButton, type AskAiButtonProps, type AskAiVariant } from "./ask-ai-button.js"
export { HAND_OFF_ACTIONS, HandOffButton, type HandOffAction } from "./hand-off-button.js"
export {
  askAiPrompt,
  modelContextText,
  fenceUntrusted,
  EMPTY_TOOL_SURFACE,
  MAX_UNTRUSTED_CHARS,
  type AskAiPrompt,
  type AskAiPromptSpec,
  type HandOffParts,
  type HandOffValue,
  type ModelContextSpec,
  type ToolSurface,
  type UntrustedText,
} from "./ask-ai-prompt.js"
export { OpenInCockpitLink } from "./open-in-cockpit-link.js"
export { useResetOnChange } from "./use-reset-on-change.js"
export { useApplyTheme } from "./use-apply-theme.js"
export { usePagedViewData, type PagedViewData } from "./use-paged-view-data.js"
export { usePagedListView, type PagedListView } from "./use-paged-list-view.js"
export { PagedRows } from "./paged-rows.js"
export { NavigationFocus } from "./navigation-focus.js"
export {
  DisplayModeControlProvider,
  DisplayModeToggle,
  SHELL_VIEW_CONFIG,
  useDisplayModeControl,
  type DisplayModeControl,
} from "./display-mode-toggle.js"
export {
  INLINE_DIAGRAM_MAX_HEIGHT,
  InlineBudgetProvider,
  NO_INLINE_BUDGET,
  RowsBudgeted,
  useInlineBudget,
  type InlineBudget,
} from "./inline-budget.js"
export {
  FIT_CONTINUES_ROW,
  InlineFitBox,
  UNSTATED_BUDGET,
  useInlineRows,
  type FitMeasure,
  type InlineRows,
} from "./inline-fit.js"
export {
  BpmnHeatmap,
  HeatmapLegend,
  type BpmnHeatmapProps,
  type BpmnHeatmapLabels,
} from "./bpmn-heatmap.js"
export { BpmnHeatmapWidget, HeatValuesTable, type BpmnHeatmapData } from "./bpmn-heatmap-widget.js"
export {
  BPMN_TOKENS,
  BPMN_OVERLAY_CSS,
  injectBpmnOverlayCss,
  markerSwatch,
  badgeSwatch,
  cdVar,
} from "./bpmn-tokens.js"
export {
  useBpmnViewer,
  diagramHeight,
  diagramBoundsFromXml,
  DIAGRAM_MIN_HEIGHT,
  DIAGRAM_MAX_HEIGHT,
  type DiagramBounds,
  type UseBpmnViewerOptions,
  type UseBpmnViewerResult,
  type BpmnCanvas,
  type BpmnOverlays,
  type BpmnElementRegistry,
  type BpmnEventBus,
  type BpmnViewerWithGet,
} from "./use-bpmn-viewer.js"
export {
  BpmnZoomControls,
  type BpmnZoomControlsLabels,
  type BpmnZoomControlsProps,
} from "./bpmn-zoom-controls.js"
