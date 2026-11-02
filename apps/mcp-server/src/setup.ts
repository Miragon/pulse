import {
  engineModule,
  configuredEngineIds,
  createBpmnXmlFetcher,
} from "@miragon/pulse-engine-connector"
import { analyticsModule, type FetchBpmnXml } from "@miragon/pulse-analytics-connector"
import type { ComposableModule, ModuleEntry } from "@miragon/pulse-widget-shell/server"

/**
 * What one module hands the others at boot. App-owned on purpose: which module's capability
 * reaches which other module is configuration knowledge; modules stay peers and never import
 * each other.
 */
export interface SharedResources {
  /** The engine module's BPMN-XML lookup (on any of its engines) for the analytics heatmap and the names in its views. */
  fetchBpmnXml?: FetchBpmnXml
  /** The engine module's configured engine ids: the only engines analytics reads from a possibly shared Prometheus. */
  engineIds?: readonly string[]
}

/** The port every module meets structurally (modules never import this file). */
export type ModuleDefinition = ComposableModule<SharedResources>

/** The modules this server composes; the boot (`createComposedServer`) selects, warns and wires them. */
export const MODULES: readonly ModuleDefinition[] = [engineModule, analyticsModule]

/**
 * The engine module hands analytics its BPMN-XML lookup and its engine ids, so analytics needs no engine
 * SDK. Without the engine module the heatmap degrades and analytics falls back to ANALYTICS_ENGINE_IDS,
 * else refuses every engine.
 */
export function sharedResources(entries: readonly ModuleEntry[]): SharedResources {
  const engine = entries.find((entry) => entry.app === engineModule.name)
  if (!engine) return {}
  return {
    fetchBpmnXml: createBpmnXmlFetcher(engine.config),
    engineIds: configuredEngineIds(engine.config),
  }
}
