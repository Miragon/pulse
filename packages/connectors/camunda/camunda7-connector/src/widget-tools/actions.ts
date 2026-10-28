import {
  appOnly,
  buildDataFeedResult as rawData,
  withToolErrors,
  strictToolInput,
} from "@miragon/pulse-widget-shell/server"
import { allowedWidgetActions } from "../lib/toolsets.js"
import { CAMUNDA7_WIDGET_ACTIONS_DATA } from "../tool-names.js"
import type { WidgetToolsContext } from "./shared.js"

/**
 * `allowedActions` uses the registrar filter's rule, so no button resolves to an unknown tool;
 * `modelTools` keeps hand-offs off tools the toolset withholds or a host hides (#338).
 */
export function registerWidgetActionsFeed(ctx: WidgetToolsContext) {
  const allowedActions = allowedWidgetActions(ctx.toolset)

  ctx.server.tool(
    {
      name: CAMUNDA7_WIDGET_ACTIONS_DATA,
      title: "Widget actions (internal)",
      description:
        "Internal JSON feed (no UI): which engine write actions the widgets may offer and which tools the model has in this deployment.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: strictToolInput({}),
      ...appOnly,
    },
    // Read per call: registrations after this one belong to the surface too.
    withToolErrors(() =>
      Promise.resolve(rawData({ allowedActions, modelTools: ctx.modelTools() })),
    ),
  )
}
