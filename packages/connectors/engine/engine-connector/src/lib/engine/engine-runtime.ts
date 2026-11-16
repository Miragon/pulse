/**
 * The engine contract's runtime of the engine a call resolved (`resolveEngine`/`withEngine`): one
 * per dialect the server serves (SERVER_SURFACE.dialects in engine-profiles.ts), today the
 * Camunda 7 REST API's, c7-core's `C7Runtime` over the connector's engine port, its failures read
 * by `runtimeErrorOf`. Built per call on the client the call resolved, like the port (invariant
 * 2): never cached. A profile of a dialect the server does not serve never gets this far: the boot
 * refuses it (`dialect-not-served`).
 */

import type { Client } from "@miragon/pulse-c7-client"
import { C7Runtime } from "@miragon/pulse-c7-core/runtime"
import type { ProcessRuntime } from "@miragon/pulse-engine-core"
import { dialectOfFlavor, type EngineDialect } from "../../engine-provider.js"
import { enginePortFor } from "../core-adapter/engine-port.js"
import type { ResolvedEngine } from "./resolve-engine.js"
import { runtimeErrorOf } from "./runtime-errors.js"

/** The runtime of each dialect the server serves, over the client of one call. */
const RUNTIMES: { readonly [D in EngineDialect]: (client: Client) => ProcessRuntime } = {
  c7: (client) => C7Runtime.over(enginePortFor(client), { failureOf: runtimeErrorOf }),
}

/** The runtime of `engine`: its dialect's, over the client its call resolved. */
export function runtimeOf(engine: Pick<ResolvedEngine, "client" | "provider">): ProcessRuntime {
  return RUNTIMES[dialectOfFlavor(engine.provider.flavor)](engine.client)
}
