import type { ModuleServer } from "@miragon/pulse-widget-shell/server"
import type { VerdictThresholds } from "@miragon/pulse-c7-core"
import type { BoardFiles } from "../board-files.js"
import type { NamedReadContext } from "../data/feeds.js"
import {
  type EngineCallContext,
  type EngineRegistry,
  resolveRuntimeEngine,
} from "../lib/engine/resolve-engine.js"
import { type EngineMark, engineServing } from "../lib/engine/served-engines.js"
import type { EngineToolset } from "../lib/mcp/toolsets.js"

export interface WidgetToolsContext {
  server: ModuleServer
  registry: EngineRegistry
  healthThresholds: VerdictThresholds
  toolset: EngineToolset
  /** The tools the registrar registered: a write button names only those. */
  registered: ReadonlySet<string>
  /** The boards of ENGINE_BOARDS_DIR; none without it. */
  boards?: BoardFiles
}

/**
 * What a read that names its own engines (a board's) reads with under one call: each engine by
 * its name alone, never the default (invariant 2), of a dialect its mark serves (the call-time
 * net), and the boards of ENGINE_BOARDS_DIR.
 */
export function namedReads(
  { registry, boards }: Pick<WidgetToolsContext, "registry" | "boards">,
  mark: EngineMark,
  call?: EngineCallContext,
): NamedReadContext {
  return {
    resolve: (name) => resolveRuntimeEngine(engineServing(name, registry, mark), registry, call),
    ...(boards ? { boards } : {}),
  }
}
