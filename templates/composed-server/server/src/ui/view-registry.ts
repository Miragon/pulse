import type { HostWidgets, ViewMap } from "@miragon/pulse-widget-shell/widgets"
import { engineViews } from "@miragon/pulse-engine-connector/widgets"
import { analyticsHostWidgets, analyticsViews } from "@miragon/pulse-analytics-connector/widgets"
import { notesViews } from "@acme/mcp-notes/widgets"

/**
 * Every view of this server by view name (= show tool name): one of the places
 * a new module is wired into (start at MODULES in `src/setup.ts`; the
 * `create-module` skill lists them all). A forgotten spread here is SILENT
 * until `test/view-registry.test.ts` names the view-bound tool without a view.
 */
export const viewRegistry: ViewMap = {
  ...engineViews,
  ...analyticsViews,
  ...notesViews,
}

/** The widgets one module renders of another by raw id: analytics' engine landscape (the engine module's fleet view) and its process heatmap with the legend (the engine module's process flow). */
export const hostWidgets: HostWidgets = {
  ...analyticsHostWidgets,
}
