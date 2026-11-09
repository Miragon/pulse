import type { Client } from "@miragon/pulse-c7-client"
import type { Flavor } from "@miragon/pulse-profile"

/** One per vendor of the C7 dialect: ONLY the real differences, never a mirror of the SDK. */

/** A profile's `flavor`: the one table of vendors is the profile format's (`FLAVORS`). */
export type EngineFlavor = Flavor

/**
 * How the server signs in to an engine: not at all, Basic, a fixed bearer token, or the MCP
 * caller's own bearer token passed through (`src/lib/engine/credentials.ts`).
 */
export type EngineAuthType = "basic" | "bearer" | "passthrough" | "none"

/** How one engine signs in, resolved from its profile at boot (the secret read from its variable). */
export interface EngineAuth {
  type: EngineAuthType
  username?: string
  password?: string
  token?: string
}

/** The client settings of one engine, handed to its provider's client factory. */
export interface EngineClientSettings {
  /**
   * Per-request deadline in ms, to the answer's last byte: the profile's `timeout`, else
   * `ENGINE_REQUEST_TIMEOUT_MS`; 30 s when neither is set.
   */
  timeoutMs?: number
  /** The profile's `readOnly`: the transport refuses every request not marked as a read. */
  readOnly?: boolean
}

/** One usable profile, as the server connects to it: its name is the engine id. */
export interface EngineEntry {
  id: string
  /** The profile's `url`, the REST API root. */
  baseUrl: string
  /** The profile's `cockpitUrl` as written (trimmed), its trailing slash kept. */
  cockpitUrl?: string
  /** Grouping only: `id` stays the globally unique `engine` selector. */
  environment?: string
  /** Engine vendor of the C7 dialect; selects the provider. Default: "camunda7". */
  flavor?: EngineFlavor
  /** Absent: no credentials. */
  auth?: EngineAuth
  /** The profile's `readOnly`: no tool writes to this engine (ENGINE_READ_ONLY). */
  readOnly?: boolean
  /** The profile's `timeout` in ms; it beats `ENGINE_REQUEST_TIMEOUT_MS`. */
  timeoutMs?: number
}

/** CIB seven routes by key/version, Camunda/Operaton by id; a missing field yields no link. */
export interface CockpitRef {
  key: string
  version: number | null
  definitionId?: string | null
  instanceId?: string | null
}

export interface EngineCockpitStrategy {
  /** Derive the webapp base from the REST baseUrl when no explicit cockpitUrl is configured. */
  deriveWebappBase(baseUrl: string): string | null
  /** Hash route (appended to the webapp base) for a process definition page, or `null`. */
  processRoute(ref: CockpitRef, tab?: string): string | null
  /** Hash route for a process *instance* page, or `null`. */
  instanceRoute(ref: CockpitRef, tab?: string): string | null
}

export interface EngineProvider {
  flavor: EngineFlavor
  /** REST-client factory, identical across vendors today; the hook exists for real divergence. */
  createClient(entry: EngineEntry, auth: EngineAuth, settings?: EngineClientSettings): Client
  cockpit: EngineCockpitStrategy
  branding: { displayName: string }
}
