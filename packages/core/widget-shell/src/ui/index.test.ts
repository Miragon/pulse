// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import * as widgets from "./index.js"

/**
 * The published entry, name by name: a name added here is a promise to every customer, a name
 * dropped a breaking change, so either is a decision made in review, not a side effect. Types are
 * erased at runtime: this locks the runtime names (knip does not report an entry's own exports).
 */
describe("the /widgets entry", () => {
  it("exports exactly these runtime names", () => {
    expect(Object.keys(widgets).sort()).toEqual([
      "AskAiButton",
      "BPMN_OVERLAY_CSS",
      "BPMN_TOKENS",
      "BpmnZoomControls",
      "ConfirmDialog",
      "FIT_CONTINUES_ROW",
      "HAND_OFF_ACTIONS",
      "HandOffButton",
      "HostModelContext",
      "IdCell",
      "IdText",
      "ListTable",
      "OpenInCockpitLink",
      "PagedRows",
      "QueryFallback",
      "RowsBudgeted",
      "SERVED_FONTS_STYLE_ID",
      "SERVED_FONT_FILES",
      "SERVED_FONT_PATH",
      "TableSkeleton",
      "TestViewHost",
      "ViewDataState",
      "ViewErrorBoundary",
      "ViewMeta",
      "ViewStack",
      "WidgetShell",
      "askAiPrompt",
      "cdVar",
      "createTestQueryClient",
      "createTranslator",
      "createViewQueryClient",
      "declareServedFonts",
      "decodeToolResult",
      "describeError",
      "formatLookback",
      "injectBpmnOverlayCss",
      "modelContextText",
      "mountView",
      "mountViews",
      "parseBpmnNames",
      "readBpmnNames",
      "servedFontBaseUrl",
      "shortId",
      "useActionFeedback",
      "useBpmnViewer",
      "useDetailView",
      "useHostDisplayMode",
      "usePagedListView",
      "usePagedViewData",
      "useQueryClient",
      "useToolMutation",
      "useToolQueries",
      "useToolQuery",
      "useViewData",
      "useViewHost",
      "viewRefreshState",
    ])
  })
})
