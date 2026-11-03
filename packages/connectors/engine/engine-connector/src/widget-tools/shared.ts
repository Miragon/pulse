import type { MCPServer } from "mcp-use"
import type { EngineHealthThresholds } from "../data/health-data.js"
import type { EngineRegistry } from "../lib/engine/resolve-engine.js"
import type { EngineToolset } from "../lib/mcp/toolsets.js"
import type { EngineParamShape } from "../lib/engine/with-engine.js"

export interface WidgetToolsContext {
  server: MCPServer
  registry: EngineRegistry
  healthThresholds: EngineHealthThresholds
  toolset: EngineToolset
  engineParam: EngineParamShape
}
