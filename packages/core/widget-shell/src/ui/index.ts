// Only what touches the host; the design kit is `@miragon/pulse-ui` (`pulse-ui-overlap.test.ts`).
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
export {
  ListTable,
  COLUMN_BREAKPOINTS,
  type ColumnBreakpoint,
  type ListTableColumn,
  type ListTableGroup,
} from "./list-table.js"
export { IdText, IdCell, shortId, copyText, ID_FULL_LENGTH } from "./id-text.js"
export { countTone, severityTone } from "./count-tone.js"
export { ConfirmDialog, type ConfirmDialogProps, type ConfirmTarget } from "./confirm-dialog.js"
export { useActionFeedback, type ActionFeedback } from "./action-feedback.js"
export { QueryFallback, TableSkeleton } from "./query-fallback.js"
export {
  ViewMeta,
  formatLookback,
  formatViewMeta,
  VIEW_META_LABELS,
  type ViewMetaEngines,
  type ViewMetaLabels,
  type ViewMetaParts,
} from "./view-meta.js"
export {
  HostWidgetSlot,
  HostWidgetsProvider,
  useHostWidget,
  useHostWidgets,
  type HostWidget,
  type HostWidgets,
} from "./host-widgets.js"
export { LocaleGate } from "./locale-gate.js"
export { ShellHostProvider, useShellHost, type ShellHost } from "./shell-host.js"
// The view runtime: the bundle root, the host seam, the data layer and the test host.
export {
  mountView,
  mountViews,
  type MountViewOptions,
  type MountViewsOptions,
} from "./view-root.js"
export { ViewStack, type ViewComponent, type ViewMap, type ViewProps } from "./views.js"
export { ViewErrorBoundary } from "./view-error-boundary.js"
export { HostModelContext, useViewHost, type ViewHost } from "./view-host.js"
export {
  createViewQueryClient,
  useQueryClient,
  useToolMutation,
  useToolQuery,
  useViewData,
  type QueryClient,
  type ToolMutationOptions,
  type ToolQueryOptions,
  type ViewDataOptions,
  type ViewDataResult,
} from "./tool-query.js"
export { decodeToolResult, type ToolResult } from "../tool-result.js"
export {
  createTranslator,
  type Catalogs,
  type Message,
  type MessageCatalog,
} from "../translator.js"
export {
  createTestQueryClient,
  TestViewHost,
  type HostAction,
  type TestViewHostProps,
} from "./test-view-host.js"
export { HostDocument } from "./host-document.js"
export { declareServedFonts, SERVED_FONTS_STYLE_ID } from "./declare-served-fonts.js"
export { SERVED_FONT_FILES, SERVED_FONT_PATH, servedFontBaseUrl } from "../served-fonts.js"
export { useDetailView } from "./use-detail-view.js"
export { viewRefreshState, type ViewRefreshState } from "./view-refresh-state.js"
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
export { useApplyTheme } from "./use-apply-theme.js"
export { usePagedViewData, type PagedViewData } from "./use-paged-view-data.js"
export { usePagedListView, type PagedListView } from "./use-paged-list-view.js"
export { PagedRows } from "./paged-rows.js"
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
