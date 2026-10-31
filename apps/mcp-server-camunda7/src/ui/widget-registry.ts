import type { WidgetComponent } from "@miragon/mcp-toolkit-ui/app"
import { camunda7Widgets } from "@miragon/pulse-camunda7-connector/widgets"
import { analyticsWidgets } from "@miragon/pulse-analytics-connector/widgets"
import { shellWidgets } from "@miragon/pulse-widget-shell/widgets"

export const widgetRegistry = {
  ...camunda7Widgets,
  ...analyticsWidgets,
  ...shellWidgets,
} satisfies Record<string, WidgetComponent>
