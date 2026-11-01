import type { HostWidgets, ViewMap } from "@miragon/pulse-widget-shell/widgets"
import { shellViews } from "@miragon/pulse-widget-shell/widgets"
import { camunda7HostWidgets, camunda7Views } from "@miragon/pulse-camunda7-connector/widgets"
import { analyticsHostWidgets, analyticsViews } from "@miragon/pulse-analytics-connector/widgets"

/** Every view of this server by view name (= show tool name); `test/view-registry.test.ts` holds it to the goldens. */
export const viewRegistry: ViewMap = {
  ...camunda7Views,
  ...analyticsViews,
  ...shellViews,
}

/**
 * The widgets one module renders of another by raw id: each module's `<module>:settings` section
 * (the shell's settings page) and analytics' engine landscape (camunda7's fleet view).
 */
export const hostWidgets: HostWidgets = {
  ...camunda7HostWidgets,
  ...analyticsHostWidgets,
}
