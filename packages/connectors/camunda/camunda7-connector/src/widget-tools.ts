import type { MCPServer } from "mcp-use"
import { DEFAULT_HEALTH_THRESHOLDS, type EngineHealthThresholds } from "./data/health-data.js"
import type { EngineRegistry } from "./lib/resolve-engine.js"
import { engineParamShapeFor } from "./lib/with-engine.js"
import type { Camunda7Toolset } from "./lib/toolsets.js"
import { createInMemoryProfileStore, type ProfileStore } from "@miragon/pulse-widget-shell/server"
import type { WidgetToolsContext } from "./widget-tools/shared.js"
import { registerCockpitWidgetTools } from "./widget-tools/cockpit.js"
import { registerInstanceWidgetTools } from "./widget-tools/instances.js"
import { registerIncidentWidgetTools } from "./widget-tools/incidents.js"
import { registerWidgetDataFeeds } from "./widget-tools/data-feeds.js"
import { registerWidgetActionsFeed } from "./widget-tools/actions.js"

export interface Camunda7WidgetToolsOptions {
  /** Per-deployment overrides for the engine-health traffic-light thresholds. */
  healthThresholds?: Partial<EngineHealthThresholds>
  /** Profile store for localizing model-facing summaries (locale → profile language). */
  profileStore?: ProfileStore
  /** Decides which in-widget write buttons render; always concrete, never "omitted = everything". */
  toolset: Camunda7Toolset
  /** Read lazily, when every registration is done. */
  modelTools?: () => string[]
}

export function registerWidgetTools(
  server: MCPServer,
  registry: EngineRegistry,
  options: Camunda7WidgetToolsOptions,
) {
  const healthThresholds: EngineHealthThresholds = {
    ...DEFAULT_HEALTH_THRESHOLDS,
    ...options.healthThresholds,
  }
  const profileStore = options.profileStore ?? createInMemoryProfileStore()

  const ctx: WidgetToolsContext = {
    server,
    registry,
    healthThresholds,
    profileStore,
    toolset: options.toolset,
    modelTools: options.modelTools ?? (() => []),
    engineParam: engineParamShapeFor(registry.engines),
  }
  registerCockpitWidgetTools(ctx)
  registerInstanceWidgetTools(ctx)
  registerIncidentWidgetTools(ctx)
  registerWidgetDataFeeds(ctx)
  registerWidgetActionsFeed(ctx)
}
