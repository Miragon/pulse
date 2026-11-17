/**
 * The engine contract's runtime of the engine a call resolved: a Camunda 7 engine's
 * (`resolveEngine`/`withEngine`, or `resolveRuntimeEngine`) is c7-core's `C7Runtime` over the
 * connector's engine port, its failures read by `runtimeErrorOf`; an engine of another dialect
 * (`resolveRuntimeEngine` alone) brings its own, bound to the call's signal. Built per call on what
 * the call resolved, like the port (invariant 2): never cached.
 */

import type { Client } from "@miragon/pulse-c7-client"
import { C7Runtime } from "@miragon/pulse-c7-core/runtime"
import type { ProcessRuntime } from "@miragon/pulse-engine-core"
import { enginePortFor } from "../core-adapter/engine-port.js"
import type { ResolvedContractEngine, ResolvedEngine } from "./resolve-engine.js"
import { runtimeErrorOf } from "./runtime-errors.js"

/** The runtime of the Camunda 7 REST API, over the client of one call. */
const RUNTIMES = {
  c7: (client: Client): ProcessRuntime =>
    C7Runtime.over(enginePortFor(client), { failureOf: runtimeErrorOf }),
} as const

/** The runtime of `engine`: C7Runtime over the client its call resolved, else its backend's own. */
export function runtimeOf(
  engine: Pick<ResolvedEngine, "client" | "provider"> | ResolvedContractEngine,
): ProcessRuntime {
  if ("client" in engine) return RUNTIMES.c7(engine.client)
  return engine.backend.runtime(engine.signal)
}
