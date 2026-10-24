import type { Camunda7AuthType, Client } from "@miragon/pulse-camunda7-client"

/**
 * The provider port: one small object per engine VENDOR of the Camunda-7
 * dialect (CIB Seven, Operaton, Camunda 7). All vendors speak the identical
 * engine-rest API — the generated client is the shared contract — so this
 * interface deliberately contains ONLY the real differences (client
 * construction hook, cockpit deep-link routes, branding). It must never grow
 * into a mirror of the SDK; a different engine DIALECT (e.g. Flowable) is a
 * separate module, not a provider.
 */

export type EngineFlavor = "cibseven" | "operaton" | "camunda7"

/**
 * Per-engine auth override. An engine that carries one is authenticated with
 * exactly these fields; engines without one fall back to the module-wide
 * config ([[Camunda7PluginConfig]]) — the two are never mixed field-by-field.
 */
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
  /**
   * The environment this engine's service runs in (e.g. "prod-eu"). A grouping
   * level for the two-stage pick-an-environment-then-an-engine selection —
   * never part of the engine identity: `id` stays the flat, globally unique
   * join key against the metrics' `engine_id` label. Absent = the implicit
   * default environment.
   */
  environment?: string
  /** Engine vendor of the C7 dialect; selects the provider. Default: "camunda7". */
  flavor?: EngineFlavor
  auth?: EngineAuth
}

/**
 * Reference to a process object for cockpit links. Each flavor's routes pick
 * the fields THEY need (CIB Seven routes by key/version, the classic
 * Camunda/Operaton cockpit by definition/instance id) — a missing required
 * field yields `null` (no link, graceful degradation).
 */
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
