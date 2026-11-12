import type { ModuleServer } from "@miragon/pulse-widget-shell/server"
import type { VerdictThresholds } from "@miragon/pulse-c7-core"
import type { EngineRegistry } from "../lib/engine/resolve-engine.js"
import type { EngineToolset } from "../lib/mcp/toolsets.js"
import type { EngineParamShape } from "../lib/engine/with-engine.js"

export interface WidgetToolsContext {
  server: ModuleServer
  registry: EngineRegistry
  healthThresholds: VerdictThresholds
  toolset: EngineToolset
  engineParam: EngineParamShape
}
