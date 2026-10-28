import type { Camunda7AuthType, Client } from "@miragon/pulse-camunda7-client"

/** One per vendor of the C7 dialect: ONLY the real differences, never a mirror of the SDK. */

export type EngineFlavor = "cibseven" | "operaton" | "camunda7"

/** Never mixed field-by-field with the module-wide fallback. */
export interface EngineAuth {
  type: Camunda7AuthType
  username?: string
  password?: string
  token?: string
}

/** Module-wide client settings (not per engine), handed to every provider's client factory. */
export interface EngineClientSettings {
  /** Per-request deadline in ms (`CAMUNDA_REQUEST_TIMEOUT_MS`); the client's default when unset. */
  timeoutMs?: number
}

export interface EngineEntry {
  id: string
  baseUrl: string
  cockpitUrl?: string
  /** Grouping only: `id` stays the globally unique join key against `engine_id`. */
  environment?: string
  /** Engine vendor of the C7 dialect; selects the provider. Default: "camunda7". */
  flavor?: EngineFlavor
  auth?: EngineAuth
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
  /** REST-client factory — identical across vendors today; the hook exists for real divergence. */
  createClient(entry: EngineEntry, auth: EngineAuth, settings?: EngineClientSettings): Client
  cockpit: EngineCockpitStrategy
  branding: { displayName: string }
}
