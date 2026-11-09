import type { ModuleServer } from "@miragon/pulse-widget-shell/server"
import type { VerdictThresholds } from "@miragon/pulse-c7-core"
import type { EngineRegistry } from "./lib/engine/resolve-engine.js"
import { engineParamShapeFor } from "./lib/engine/with-engine.js"
import type { EngineToolset } from "./lib/mcp/toolsets.js"
import type { WidgetToolsContext } from "./widget-tools/shared.js"
import { registerCockpitWidgetTools } from "./widget-tools/cockpit.js"
import { registerWidgetDataFeeds } from "./widget-tools/data-feeds.js"
import { registerWidgetActionsFeed } from "./widget-tools/actions.js"

export interface EngineWidgetToolsOptions {
  /** The verdict's thresholds in force (`ENGINE_HEALTH_*` over the defaults), shared with `engine_status`. */
  healthThresholds: VerdictThresholds
  /** Decides which in-widget write buttons render; always concrete, never "omitted = everything". */
  toolset: EngineToolset
}

export function registerWidgetTools(
  server: ModuleServer,
  registry: EngineRegistry,
  options: EngineWidgetToolsOptions,
) {
  const ctx: WidgetToolsContext = {
    server,
    registry,
    healthThresholds: options.healthThresholds,
    toolset: options.toolset,
    engineParam: engineParamShapeFor(registry.engines),
  }
  registerCockpitWidgetTools(ctx)
  registerWidgetDataFeeds(ctx)
  registerWidgetActionsFeed(ctx)
}
