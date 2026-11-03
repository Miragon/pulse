import type { MCPServer } from "mcp-use"
import { DEFAULT_HEALTH_THRESHOLDS, type EngineHealthThresholds } from "./data/health-data.js"
import type { EngineRegistry } from "./lib/engine/resolve-engine.js"
import { engineParamShapeFor } from "./lib/engine/with-engine.js"
import type { EngineToolset } from "./lib/mcp/toolsets.js"
import type { WidgetToolsContext } from "./widget-tools/shared.js"
import { registerCockpitWidgetTools } from "./widget-tools/cockpit.js"
import { registerWidgetDataFeeds } from "./widget-tools/data-feeds.js"
import { registerWidgetActionsFeed } from "./widget-tools/actions.js"

export interface EngineWidgetToolsOptions {
  /** Per-deployment overrides for the engine-health traffic-light thresholds. */
  healthThresholds?: Partial<EngineHealthThresholds>
  /** Decides which in-widget write buttons render; always concrete, never "omitted = everything". */
  toolset: EngineToolset
}

export function registerWidgetTools(
  server: MCPServer,
  registry: EngineRegistry,
  options: EngineWidgetToolsOptions,
) {
  const healthThresholds: EngineHealthThresholds = {
    ...DEFAULT_HEALTH_THRESHOLDS,
    ...options.healthThresholds,
  }

  const ctx: WidgetToolsContext = {
    server,
    registry,
    healthThresholds,
    toolset: options.toolset,
    engineParam: engineParamShapeFor(registry.engines),
  }
  registerCockpitWidgetTools(ctx)
  registerWidgetDataFeeds(ctx)
  registerWidgetActionsFeed(ctx)
}
