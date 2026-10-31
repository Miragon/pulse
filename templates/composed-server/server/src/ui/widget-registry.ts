import type { WidgetComponent } from "@miragon/mcp-toolkit-ui/app"
import { camunda7Widgets } from "@miragon/pulse-camunda7-connector/widgets"
import { analyticsWidgets } from "@miragon/pulse-analytics-connector/widgets"
import { notesWidgets } from "@acme/mcp-notes/widgets"
import { shellWidgets } from "@miragon/pulse-widget-shell/widgets"

/**
 * The host bundle map — one of the places a new module is wired into (start
 * at MODULES in `src/setup.ts`; the `create-module` skill lists them all). A
 * forgotten spread here is SILENT: the module's tools work but every widget
 * renders as an empty slot. `test/widget-registry.test.ts` guards it against
 * every widget id the modules' show tools name.
 */
export const widgetRegistry = {
  ...camunda7Widgets,
  ...analyticsWidgets,
  ...notesWidgets,
  // The shell's widgets: the settings page with its language section.
  ...shellWidgets,
} satisfies Record<string, WidgetComponent>
