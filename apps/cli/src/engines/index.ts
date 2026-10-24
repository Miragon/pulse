/** The engines pulse-cli supports, one adapter each. */

import type { EngineAdapter, EngineName } from "../engine-port/engine-adapter.js"
import { camunda7 } from "./camunda7/adapter.js"
import { cibseven } from "./cibseven/adapter.js"
import { operaton } from "./operaton/adapter.js"

export const ENGINES: Readonly<Record<EngineName, EngineAdapter>> = {
  operaton,
  cibseven,
  camunda7,
}
