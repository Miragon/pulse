/** An engine as pulse-cli sees it: its name, its command catalog and its port. Types only. */

import type { Catalog } from "../catalog/types.js"
import type { Flavor } from "../config/types.js"
import type { ClientOptions } from "../http/client.js"
import type { Target } from "../operation/request.js"
import type { EnginePort } from "./engine-port.js"

export type EngineName = Flavor

export interface EngineAdapter {
  readonly name: EngineName
  readonly catalog: Catalog
  port(target: Target, client: ClientOptions): EnginePort
}
