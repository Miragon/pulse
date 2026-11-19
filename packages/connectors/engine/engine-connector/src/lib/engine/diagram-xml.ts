/**
 * A deployed definition's diagram XML on the engine a dialect-neutral read resolved
 * (`resolveRuntimeEngine`), through the one XML cache (`lib/bpmn/definition-xml.ts`): a Camunda 7
 * engine's through its client, with the request and the cache of every Camunda 7 path, another
 * dialect's through its runtime's `getDiagramXml`, kept under its configured engine.
 */

import { DefinitionId } from "@miragon/pulse-engine-core"
import { cachedDefinitionXml, fetchDefinitionXml } from "../bpmn/definition-xml.js"
import { runtimeOf } from "./engine-runtime.js"
import type { RuntimeEngine } from "./resolve-engine.js"

/** The XML of `definitionId` on `engine`, or `null` when the engine has none for it. */
export function diagramXmlOf(engine: RuntimeEngine, definitionId: string): Promise<string | null> {
  if ("client" in engine) return fetchDefinitionXml(engine.client, definitionId)
  return cachedDefinitionXml(
    engine.backend,
    definitionId,
    async (id) => (await runtimeOf(engine).getDiagramXml(DefinitionId(id))) ?? null,
  )
}
