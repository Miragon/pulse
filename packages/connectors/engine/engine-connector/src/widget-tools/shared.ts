import type { ModuleServer } from "@miragon/pulse-widget-shell/server"
import type { VerdictThresholds } from "@miragon/pulse-c7-core"
import type { BoardFiles } from "../board-files.js"
import type { NamedReadContext } from "../data/feeds.js"
import {
  type EngineCallContext,
  type EngineRegistry,
  resolveRuntimeEngine,
} from "../lib/engine/resolve-engine.js"
import type { EngineToolset } from "../lib/mcp/toolsets.js"
import type { EngineParamShape } from "../lib/engine/with-engine.js"

export interface WidgetToolsContext {
  server: ModuleServer
  registry: EngineRegistry
  healthThresholds: VerdictThresholds
  toolset: EngineToolset
  engineParam: EngineParamShape
  /** The boards of ENGINE_BOARDS_DIR; none without it. */
  boards?: BoardFiles
}

/**
 * What a read that names its own engines (a board's) reads with under one call: each engine by
 * its name alone, never the default (invariant 2), of any dialect the server reads, and the boards
 * of ENGINE_BOARDS_DIR.
 */
export function namedReads(
  { registry, boards }: Pick<WidgetToolsContext, "registry" | "boards">,
  call?: EngineCallContext,
): NamedReadContext {
  return {
    resolve: (name) => resolveRuntimeEngine(name, registry, call),
    ...(boards ? { boards } : {}),
  }
}
