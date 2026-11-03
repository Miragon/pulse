import type { HostWidgets, ViewMap } from "@miragon/pulse-widget-shell/widgets"
import { engineViews } from "@miragon/pulse-engine-connector/widgets"
import { analyticsHostWidgets, analyticsViews } from "@miragon/pulse-analytics-connector/widgets"

/** Every view of this server by view name (= its view tool's name); `test/view-registry.test.ts` holds it to the goldens. */
export const viewRegistry: ViewMap = {
  ...engineViews,
  ...analyticsViews,
}

/** The widgets one module renders of another by raw id: analytics' engine landscape (the engine module's fleet view) and its process heatmap with the legend (the engine module's process flow). */
export const hostWidgets: HostWidgets = {
  ...analyticsHostWidgets,
}
