// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import * as widgets from "./index.js"

/** A piece missing from `/widgets` is a piece no connector can import. */
describe("the /widgets entry", () => {
  it.each([
    "ListTable",
    "COLUMN_BREAKPOINTS",
    "BpmnHeatmapWidget",
    "HeatValuesTable",
    "countTone",
    "severityTone",
    // The view runtime.
    "mountViews",
    "mountView",
    "ViewStack",
    "ViewErrorBoundary",
    "useViewHost",
    "HostModelContext",
    "useHostWidget",
    "settingsSections",
    "useToolQuery",
    "useToolMutation",
    "useViewData",
    "createViewQueryClient",
    "useQueryClient",
    "decodeToolResult",
    "createTranslator",
    "TestViewHost",
    "createTestQueryClient",
    "SettingsPage",
    "shellViews",
  ])("exports %s", (name) => {
    expect(widgets).toHaveProperty(name)
    expect(widgets[name as keyof typeof widgets]).toBeDefined()
  })
})
