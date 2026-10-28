import { createCamunda7Client, type Client } from "@miragon/pulse-camunda7-client"
import type { EngineAuth, EngineClientSettings, EngineEntry } from "../engine-provider.js"
import { resolveMcpBearerToken } from "../lib/mcp-auth.js"

/** One function, so a real vendor divergence later is an explicit fork visible in review. */
export function createDialectClient(
  entry: EngineEntry,
  auth: EngineAuth,
  settings: EngineClientSettings = {},
): Client {
  return createCamunda7Client({
    baseUrl: entry.baseUrl,
    // In a fleet the model must know WHICH engine failed to retry against the right one.
    engineId: entry.id,
    timeoutMs: settings.timeoutMs,
    authType: auth.type,
    username: auth.username,
    password: auth.password,
    token: auth.token,
    // Read per call, so the client cached at boot stays correct for passthrough.
    tokenProvider: auth.type === "passthrough" ? resolveMcpBearerToken : undefined,
  })
}
