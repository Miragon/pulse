import type { MCPServer } from "mcp-use"
import type { EngineHealthThresholds } from "../data/health-data.js"
import { clusterDetailFilterShape, pagingShape } from "../feed-contracts.js"
import type { EngineRegistry, resolveEngine } from "../lib/resolve-engine.js"
import type { EngineToolset } from "../lib/toolsets.js"
import type { EngineParamShape } from "../lib/with-engine.js"

export type ResolvedEngine = ReturnType<typeof resolveEngine>

export const clusterDetailShape = { ...clusterDetailFilterShape, ...pagingShape }

export interface WidgetToolsContext {
  server: MCPServer
  registry: EngineRegistry
  healthThresholds: EngineHealthThresholds
  toolset: EngineToolset
  engineParam: EngineParamShape
}
