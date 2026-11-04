import type { MCPServer } from "mcp-use"
import type { VerdictThresholds } from "@miragon/pulse-engine-core"
import type { EngineRegistry } from "../lib/engine/resolve-engine.js"
import type { EngineToolset } from "../lib/mcp/toolsets.js"
import type { EngineParamShape } from "../lib/engine/with-engine.js"

export interface WidgetToolsContext {
  server: MCPServer
  registry: EngineRegistry
  healthThresholds: VerdictThresholds
  toolset: EngineToolset
  engineParam: EngineParamShape
}
