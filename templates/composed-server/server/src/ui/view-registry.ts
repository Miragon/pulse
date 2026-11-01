import type { HostWidgets, ViewMap } from "@miragon/pulse-widget-shell/widgets"
import { shellViews } from "@miragon/pulse-widget-shell/widgets"
import { camunda7HostWidgets, camunda7Views } from "@miragon/pulse-camunda7-connector/widgets"
import { analyticsHostWidgets, analyticsViews } from "@miragon/pulse-analytics-connector/widgets"
import { notesViews } from "@acme/mcp-notes/widgets"

/**
 * Every view of this server by view name (= show tool name): one of the places
 * a new module is wired into (start at MODULES in `src/setup.ts`; the
 * `create-module` skill lists them all). A forgotten spread here is SILENT
 * until `test/view-registry.test.ts` names the view-bound tool without a view.
 */
export const viewRegistry: ViewMap = {
  ...camunda7Views,
  ...analyticsViews,
  ...notesViews,
  // The shell's view: the settings page with its language section.
  ...shellViews,
}

/**
 * The widgets one module renders of another by raw id: every module's
 * `<module>:settings` section (the shell's settings page renders them in this
 * order) and analytics' engine landscape (camunda7's fleet view).
 */
export const hostWidgets: HostWidgets = {
  ...camunda7HostWidgets,
  ...analyticsHostWidgets,
}
