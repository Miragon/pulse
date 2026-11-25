// Only what touches the host; the design kit is `@miragon/pulse-ui` (`pulse-ui-overlap.test.ts`).
// What a widget, a view map, a bundle root or a widget test uses, with the types its signatures
// name; the view root's providers, the inline-fit machinery and the BPMN viewer's internals stay
// behind `mountViews` and the components.
export { WidgetShell, useHostDisplayMode } from "./widget-shell.js"
export { StartPageLink, ViewDataState } from "./view-data-state.js"
export {
  describeError,
  isPermanentError,
  isSessionEnded,
  type DescribeErrorOptions,
  type DescribedError,
} from "./describe-error.js"
export type { PageHints } from "./page-hints.js"
export { ListTable, type ListTableColumn, type ListTableGroup } from "./list-table.js"
export { ListRow } from "./list-row.js"
export { IdText, IdCell } from "./id-text.js"
export { TextBlock, type TextBlockProps } from "./text-block.js"
export { ConfirmDialog, type ConfirmDialogProps, type ConfirmTarget } from "./confirm-dialog.js"
export { useActionFeedback, type ActionFeedback } from "./action-feedback.js"
export { QueryFallback, TableSkeleton } from "./query-fallback.js"
// The bar's freshness stamp is the kit's (`FreshnessStamp` in @miragon/pulse-ui).
export { ViewMeta, formatLookback, type ViewMetaEngines, type ViewMetaParts } from "./view-meta.js"
// The view runtime: the bundle root, the host seam, the data layer and the test host.
export {
  mountView,
  mountViews,
  type MountViewOptions,
  type MountViewsOptions,
} from "./view-root.js"
// The page roots: a page's own app outside a chat, a view in it, and one view on a page, under the
// browser adapter instead of ext-apps.
export { mountApp, type MountAppOptions } from "./app-root.js"
export { PageView, type FailedStart, type PageViewProps } from "./page-view.js"
export {
  mountPage,
  type FramePageOptions,
  type MountPageOptions,
  type PageFrame,
} from "./page-root.js"
export type { BrowserHostOptions, ToolCaller } from "./browser-view-host.js"
export { ViewStack, type ViewComponent, type ViewMap, type ViewProps } from "./views.js"
export { ViewErrorBoundary } from "./view-error-boundary.js"
export {
  HostModelContext,
  useErrorWords,
  useHostChrome,
  useHostFollowUp,
  useHostLocation,
  useHostWrites,
  useStartPage,
  useViewHost,
  type FollowUp,
  type HostChrome,
  type ViewHost,
  type ViewLocation,
  type ToolCallOptions,
  type ViewPlace,
} from "./view-host.js"
export {
  createViewQueryClient,
  useQueryClient,
  useToolMutation,
  useToolQueries,
  useToolQuery,
  useViewData,
  type QueryClient,
  type ToolMutationOptions,
  type ToolQueryOptions,
  type ToolRead,
  type ViewDataOptions,
  type ViewDataResult,
} from "./tool-query.js"
// Also on `/server`, with their types (both from src/protocol/, the tree the halves share): the
// view runtime decodes `ViewHost.callTool`'s raw result as the server's tool tests do, and widget
// strings and server summaries both translate.
export { decodeToolResult, type ToolResult } from "../protocol/tool-result.js"
export {
  createTranslator,
  type Catalogs,
  type Message,
  type MessageCatalog,
  type Translator,
} from "../protocol/translator.js"
export {
  createTestQueryClient,
  TestViewHost,
  type HostAction,
  type TestViewHostProps,
} from "./test-view-host.js"
// The served fonts (owner order: unchanged).
export { declareServedFonts, SERVED_FONTS_STYLE_ID } from "./declare-served-fonts.js"
export { SERVED_FONT_FILES, SERVED_FONT_PATH, servedFontBaseUrl } from "../protocol/served-fonts.js"
export { useDetailView } from "./use-detail-view.js"
export { viewRefreshState, type ViewRefreshState } from "./view-refresh-state.js"
// Public for a customer's own hand-off that HAND_OFF_ACTIONS does not list; Pulse's own
// connectors are banned from it by ESLint and use HandOffButton.
export {
  AskAiButton,
  type AskAiButtonProps,
  type AskAiSize,
  type AskAiVariant,
} from "./ask-ai-button.js"
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
export { RowsBudgeted, useDiagramMaxHeight } from "./inline-budget.js"
export type { InlineRows } from "./inline-fit.js"
export { FIT_CONTINUES_ROW } from "./inline-fit-registry.js"
// The BPMN diagram, its viewer, its canvas's tokens and the name reader a view draws with are
// pulse-ui's (`@miragon/pulse-ui/bpmn`); a view hands its diagram the host's inline budget
// (`useDiagramMaxHeight`).
// The web app's wire contract (src/protocol/), which a page's client and the server's routes read,
// and that client: the session and the caller a page hands `mountApp` or `mountPage`.
export {
  isSignedOutReason,
  SIGNED_OUT_REASONS,
  WEB_CODES,
  WEB_CSRF_HEADER,
  WEB_PATHS,
  WEB_QUERY,
  type SignedOutReason,
  type WebCall,
  type WebCallAnswer,
  type WebCode,
  type WebRefusal,
  type WebSessionInfo,
  type WebSignOut,
} from "../protocol/web.js"
export {
  readWebSession,
  WebApiError,
  webToolCaller,
  type WebClientOptions,
  type WebToolCallerOptions,
} from "./web-caller.js"
