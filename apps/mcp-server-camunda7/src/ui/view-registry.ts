import type { HostWidgets, ViewMap } from "@miragon/pulse-widget-shell/widgets"
import { camunda7Views } from "@miragon/pulse-camunda7-connector/widgets"
import { analyticsHostWidgets, analyticsViews } from "@miragon/pulse-analytics-connector/widgets"

/** Every view of this server by view name (= its view tool's name); `test/view-registry.test.ts` holds it to the goldens. */
export const viewRegistry: ViewMap = {
  ...camunda7Views,
  ...analyticsViews,
}

/** The widgets one module renders of another by raw id: analytics' engine landscape (camunda7's fleet view). */
export const hostWidgets: HostWidgets = {
  ...analyticsHostWidgets,
}
