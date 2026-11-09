import type { Client } from "@miragon/pulse-c7-client"
import type { EngineAuth, EngineClientSettings, EngineEntry } from "../engine-provider.js"
import { createEngineConnection } from "../lib/engine/engine-connection.js"

/** One function, so a real vendor divergence later is an explicit fork visible in review. */
export function createDialectClient(
  entry: EngineEntry,
  auth: EngineAuth,
  settings: EngineClientSettings = {},
): Client {
  // In a fleet the model must know WHICH engine failed to retry against the right one: every
  // message names `entry.id`. The passthrough token is read per request, so the client built
  // at boot stays correct for every caller.
  return createEngineConnection(entry, auth, settings)
}
