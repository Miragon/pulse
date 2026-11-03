// Only what touches the host; the design kit is `@miragon/pulse-ui` (`pulse-ui-overlap.test.ts`).
// What a widget, a view map, a bundle root or a widget test uses, with the types its signatures
// name; the view root's providers, the inline-fit machinery and the BPMN viewer's internals stay
// behind `mountViews` and the components.
export { WidgetShell, useHostDisplayMode } from "./widget-shell.js"
export { ViewDataState } from "./view-data-state.js"
export { describeError, type DescribeErrorOptions, type DescribedError } from "./describe-error.js"
export { ListTable, type ListTableColumn, type ListTableGroup } from "./list-table.js"
export { IdText, IdCell, shortId } from "./id-text.js"
export { countTone, severityTone } from "./count-tone.js"
export { ConfirmDialog, type ConfirmDialogProps, type ConfirmTarget } from "./confirm-dialog.js"
export { useActionFeedback, type ActionFeedback } from "./action-feedback.js"
export { QueryFallback, TableSkeleton } from "./query-fallback.js"
export { ViewMeta, formatLookback, type ViewMetaEngines, type ViewMetaParts } from "./view-meta.js"
export { HostWidgetSlot, useHostWidget, type HostWidget, type HostWidgets } from "./host-widgets.js"
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
// Also on `/server`, with their types: the view runtime decodes `ViewHost.callTool`'s raw result
// as the server's tool tests do, and widget strings and server summaries both translate.
export { decodeToolResult, type ToolResult } from "../tool-result.js"
export {
  createTranslator,
  type Catalogs,
  type Message,
  type MessageCatalog,
  type Translator,
} from "../translator.js"
export {
  createTestQueryClient,
  TestViewHost,
  type HostAction,
  type TestViewHostProps,
} from "./test-view-host.js"
// The served fonts (owner order: unchanged).
export { declareServedFonts, SERVED_FONTS_STYLE_ID } from "./declare-served-fonts.js"
export { SERVED_FONT_FILES, SERVED_FONT_PATH, servedFontBaseUrl } from "../served-fonts.js"
export { useDetailView } from "./use-detail-view.js"
export { viewRefreshState, type ViewRefreshState } from "./view-refresh-state.js"
// Public for a customer's own hand-off that HAND_OFF_ACTIONS does not list; Pulse's own
// connectors are banned from it by ESLint and use HandOffButton.
export { AskAiButton, type AskAiButtonProps, type AskAiVariant } from "./ask-ai-button.js"
export { HAND_OFF_ACTIONS, HandOffButton, type HandOffAction } from "./hand-off-button.js"
export {
  askAiPrompt,
  modelContextText,
  type AskAiPrompt,
  type AskAiPromptSpec,
  type HandOffParts,
  type ModelContextSpec,
} from "./ask-ai-prompt.js"
export { OpenInCockpitLink } from "./open-in-cockpit-link.js"
export { usePagedViewData, type PagedViewData } from "./use-paged-view-data.js"
export { usePagedListView, type PagedListView } from "./use-paged-list-view.js"
export { PagedRows } from "./paged-rows.js"
export { RowsBudgeted } from "./inline-budget.js"
export type { InlineRows } from "./inline-fit.js"
export { FIT_CONTINUES_ROW } from "./inline-fit-registry.js"
export { BpmnHeatmap, HeatmapLegend, type BpmnHeatmapProps } from "./bpmn-heatmap.js"
export type { BpmnHeatmapLabels } from "./bpmn-heatmap-labels.js"
export { BpmnHeatmapWidget, type BpmnHeatmapData } from "./bpmn-heatmap-widget.js"
export { BPMN_TOKENS, BPMN_OVERLAY_CSS, injectBpmnOverlayCss, cdVar } from "./bpmn-tokens.js"
export {
  useBpmnViewer,
  type BpmnCanvas,
  type BpmnOverlays,
  type BpmnViewerWithGet,
  type UseBpmnViewerOptions,
  type UseBpmnViewerResult,
} from "./use-bpmn-viewer.js"
export { BpmnZoomControls, type BpmnZoomControlsProps } from "./bpmn-zoom-controls.js"
