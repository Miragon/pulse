import {
  appOnly,
  buildDataFeedResult as rawData,
  withToolErrors,
  strictToolInput,
} from "@miragon/pulse-widget-shell/server"
import { allowedWidgetActions } from "../lib/mcp/toolsets.js"
import { ENGINE_WIDGET_ACTIONS_DATA } from "../tool-names.js"
import type { WidgetToolsContext } from "./shared.js"

/**
 * `allowedActions` uses the registrar filter's rule, so no button resolves to an unknown tool;
 * `readOnlyEngines` names the engines whose profile is read-only, where no write runs.
 */
export function registerWidgetActionsFeed(ctx: WidgetToolsContext) {
  const allowedActions = allowedWidgetActions(ctx.toolset)
  const readOnlyEngines = [...ctx.registry.backends]
    .filter(([, backend]) => backend.readOnly)
    .map(([engineId]) => engineId)

  ctx.server.registerTool(
    ENGINE_WIDGET_ACTIONS_DATA,
    {
      title: "Widget actions (internal)",
      description:
        "Internal JSON feed (no UI): which engine write actions the widgets may offer in this deployment.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: strictToolInput({}),
      ...appOnly,
    },
    withToolErrors(() => Promise.resolve(rawData({ allowedActions, readOnlyEngines }))),
  )
}
