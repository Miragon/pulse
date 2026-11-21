/**
 * The engine contract's runtime of the engine a call resolved: a Camunda 7 engine's
 * (`resolveEngine`/`withEngine`, or `resolveRuntimeEngine`) is c7-core's `C7Runtime` over the
 * connector's engine port, its failures read by `runtimeErrorOf`; an engine of another dialect
 * (`resolveRuntimeEngine` alone) brings its own, bound to the call's signal: a Camunda 8 engine's
 * is c8-core's `C8Runtime` over the transport of its connection (`c8RuntimeOf`), its failures in
 * the server's Camunda 8 words (c8-errors.ts). Built per call on what the call resolved, like the
 * port (invariant 2): never cached. A Camunda 7 runtime reads each diagram (its own, the calls of a
 * version, the call activities of its element statistics) through the one XML cache
 * (`fetchDefinitionXml`), which keeps it per engine and caller across calls.
 */

import type { Client } from "@miragon/pulse-c7-client"
import { C7Runtime } from "@miragon/pulse-c7-core/runtime"
import { C8Runtime } from "@miragon/pulse-c8-core"
import type { ProcessRuntime } from "@miragon/pulse-engine-core"
import type { EngineAuth, EngineClientSettings, EngineEntry } from "../../engine-provider.js"
import { fetchDefinitionXml } from "../bpmn/definition-xml.js"
import { enginePortFor, noneIfMissing } from "../core-adapter/engine-port.js"
import { type C8Auth, type C8Connection, createC8Connection } from "./c8-connection.js"
import { c8WordsOf } from "./c8-errors.js"
import type { ContractRuntime, ResolvedContractEngine, ResolvedEngine } from "./resolve-engine.js"
import { runtimeErrorOf } from "./runtime-errors.js"

/**
 * A version's diagram through the one XML cache under `client`: none for a version the engine does
 * not know (a missing resource, which the cache does not keep), any other failure as it is.
 */
async function cachedDiagramXml(client: Client, definitionId: string): Promise<string | undefined> {
  return (await noneIfMissing(fetchDefinitionXml(client, definitionId))) ?? undefined
}

/** The runtime of the Camunda 7 REST API, over the client of one call. */
const RUNTIMES = {
  c7: (client: Client): C7Runtime =>
    C7Runtime.over(enginePortFor(client), {
      failureOf: runtimeErrorOf,
      diagramXml: (definitionId) => cachedDiagramXml(client, definitionId),
    }),
} as const

/**
 * The runtime of the Camunda 7 REST API over `client`, the client a Camunda 7 call resolved, with
 * its read beyond the contract (the counts on a diagram with the jobs without retries).
 */
export function c7RuntimeOf(client: Client): C7Runtime {
  return RUNTIMES.c7(client)
}

/** The runtime of `engine`: C7Runtime over the client its call resolved, else its backend's own. */
export function runtimeOf(
  engine: Pick<ResolvedEngine, "client" | "provider"> | ResolvedContractEngine,
): ProcessRuntime {
  if ("client" in engine) return RUNTIMES.c7(engine.client)
  return engine.backend.runtime(engine.signal)
}

/**
 * The runtime of a Camunda 8 engine for one call: c8-core's `C8Runtime` over the transport of its
 * connection (built once at boot), each request aborting with the call's signal.
 */
export function c8RuntimeOf(connection: C8Connection): ContractRuntime {
  const wordsOf = c8WordsOf(connection)
  return (signal) => C8Runtime.over(connection.transport(signal), { wordsOf })
}

/** The sign-in of a Camunda 8 engine: the profiles refuse every other auth type at configuration. */
function c8AuthOf(engineId: string, auth: EngineAuth = { type: "none" }): C8Auth {
  const { type } = auth
  if (type === "none" || type === "basic" || type === "clientCredentials") return { ...auth, type }
  throw new Error(
    `Engine "${engineId}" is a Camunda 8 engine, which the server never signs in to with ${type}`,
  )
}

/**
 * The runtime of a configured engine of another dialect than the Camunda 7 REST API's, built once
 * at boot (`createEngineRegistry`'s `contractRuntime`): today Camunda 8's, over a connection of
 * its own with the profile's sign-in and deadline, else `settings`'.
 */
export function contractRuntimeOf(
  entry: EngineEntry,
  settings: Pick<EngineClientSettings, "timeoutMs"> = {},
): ContractRuntime {
  const auth = c8AuthOf(entry.id, entry.auth)
  return c8RuntimeOf(
    createC8Connection(entry, auth, { timeoutMs: entry.timeoutMs ?? settings.timeoutMs }),
  )
}
