import {
  camunda7Module,
  configuredEngineIds,
  createBpmnXmlFetcher,
} from "@miragon/pulse-camunda7-connector"
import { analyticsModule, type FetchBpmnXml } from "@miragon/pulse-analytics-connector"
import type { ComposableModule, ModuleEntry } from "@miragon/pulse-widget-shell/server"

/**
 * What one module hands the others at boot. App-owned on purpose: which module's capability
 * reaches which other module is configuration knowledge; modules stay peers and never import
 * each other.
 */
export interface SharedResources {
  /** camunda7's BPMN-XML lookup (on any of its engines) for the analytics heatmap and the names in its views. */
  fetchBpmnXml?: FetchBpmnXml
  /** camunda7's configured engine ids: the only engines analytics reads from a possibly shared Prometheus. */
  engineIds?: readonly string[]
}

/** The port every module meets structurally (modules never import this file). */
export type ModuleDefinition = ComposableModule<SharedResources>

/** The modules this server composes; the boot (`createComposedServer`) selects, warns and wires them. */
export const MODULES: readonly ModuleDefinition[] = [camunda7Module, analyticsModule]

/**
 * camunda7 hands analytics its BPMN-XML lookup and its engine ids, so analytics needs no engine
 * SDK. Without camunda7 the heatmap degrades and analytics falls back to ANALYTICS_ENGINE_IDS,
 * else refuses every engine.
 */
export function sharedResources(entries: readonly ModuleEntry[]): SharedResources {
  const camunda7 = entries.find((entry) => entry.app === camunda7Module.name)
  if (!camunda7) return {}
  return {
    fetchBpmnXml: createBpmnXmlFetcher(camunda7.config),
    engineIds: configuredEngineIds(camunda7.config),
  }
}
