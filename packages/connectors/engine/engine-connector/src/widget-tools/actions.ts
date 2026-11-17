import {
  appOnly,
  buildDataFeedResult as rawData,
  withToolErrors,
  strictToolInput,
} from "@miragon/pulse-widget-shell/server"
import { servedEngineIds } from "../lib/engine/served-engines.js"
import { allowedWidgetActions } from "../lib/mcp/toolsets.js"
import { ENGINE_WIDGET_ACTIONS_DATA } from "../tool-names.js"
import type { WidgetToolsContext } from "./shared.js"

/**
 * Its mark: the writes it names are the Camunda 7 REST API's, so a server without such an engine,
 * whose views offer no write, registers it not.
 */
const WIDGET_ACTIONS_MARK = { dialects: ["c7"] } as const

/**
 * `allowedActions` names the writes the toolset holds and the registrar registered (an engine it
 * serves is writable), so no button resolves to an unknown tool; `readOnlyEngines` names the
 * engines whose profile is read-only, where no write runs.
 */
export function registerWidgetActionsFeed(ctx: WidgetToolsContext) {
  if (servedEngineIds(ctx.registry, WIDGET_ACTIONS_MARK).length === 0) return
  const allowedActions = allowedWidgetActions(ctx.toolset).filter((name) =>
    ctx.registered.has(name),
  )
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
