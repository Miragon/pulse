import { engineModule } from "@miragon/pulse-engine-connector"
import { notesModule } from "@acme/mcp-notes"
import type { ComposableModule } from "@miragon/pulse-widget-shell/server"

/**
 * What the modules of this composition share at boot: the port through which one module gets
 * another's capability (the engine module's engine access, say) without importing it. Yours on
 * purpose: which module's capability reaches which other module is configuration knowledge;
 * modules stay peers and never import each other. Today the server hands nothing through: give
 * this type the field a module of yours types in `createPlugin(config, shared)`, and fill it in
 * `sharedResources` below.
 */
export type SharedResources = Record<string, never>

/** The port every module meets structurally; modules never import this file, yours need not either. */
export type ModuleDefinition = ComposableModule<SharedResources>

/**
 * The modules THIS server composes; the boot selects, warns and wires them. Adding a module
 * touches this list, the spread in `src/ui/view-registry.ts` next to its `workspace:*`
 * dependency and `MCP_ACTIVE_MODULES` in `.env.example` (the `create-module` skill walks through
 * them, and through removing the example).
 * The guard tests in `test/` derive what they check from this list and the tools it registers, so
 * adding, replacing or dropping a module needs no test edit; only `test/example-notes.test.ts`
 * names the example module, and it goes with it.
 */
export const MODULES: readonly ModuleDefinition[] = [engineModule, notesModule]

/**
 * What the active modules share, built once at boot from their entries (`createComposedServer`'s
 * `shared`, called with the active `ModuleEntry[]`, each with the config its module's
 * `createPlugin` gets): nothing yet.
 */
export function sharedResources(): SharedResources {
  return {}
}
