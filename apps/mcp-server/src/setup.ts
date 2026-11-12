import { engineModule } from "@miragon/pulse-engine-connector"
import type { ComposableModule } from "@miragon/pulse-widget-shell/server"

/**
 * What the modules of this composition share at boot: the port through which one module gets
 * another's capability (the engine module's engine access, say) without importing it. App-owned
 * on purpose: which module's capability reaches which other module is configuration knowledge;
 * modules stay peers and never import each other. Today the app hands nothing through.
 */
export type SharedResources = Record<string, never>

/** The port every module meets structurally (modules never import this file). */
export type ModuleDefinition = ComposableModule<SharedResources>

/** The modules this server composes; the boot (`createComposedServer`) selects, warns and wires them. */
export const MODULES: readonly ModuleDefinition[] = [engineModule]

/**
 * What the active modules share, built once at boot from their entries (`createComposedServer`'s
 * `shared`, called with `ModuleEntry[]`): nothing yet.
 */
export function sharedResources(): SharedResources {
  return {}
}
