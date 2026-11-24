import type { ModuleServer } from "@miragon/pulse-widget-shell/server"
import type { VerdictThresholds } from "@miragon/pulse-c7-core"
import type { BoardFiles } from "../board-files.js"
import type { EngineRegistry } from "../lib/engine/resolve-engine.js"
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
