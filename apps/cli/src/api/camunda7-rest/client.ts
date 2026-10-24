/** The Camunda 7 REST API: the engine port over a catalog, shared by the engines that speak it. */

import type { Catalog } from "../../catalog/types.js"
import type { EngineAdapter, EngineName } from "../../engine-port/engine-adapter.js"
import { enginePort } from "../../workflow/engine.js"

/** An adapter of `name` with its generated catalog (`src/generated/catalog.<name>.json`). */
export function createCamunda7RestClient(name: EngineName, generated: unknown): EngineAdapter {
  const catalog = generated as Catalog
  return { name, catalog, port: (target, client) => enginePort(catalog, target, client) }
}
