import type { Client } from "@miragon/pulse-c7-client"
import type { Dialect, Flavor, FLAVORS } from "@miragon/pulse-profile"

/** One per vendor: ONLY the real differences, never a mirror of the SDK. */

/** A profile's `flavor`: every vendor of the profile format's one table (`FLAVORS`) has a provider. */
export type EngineFlavor = Flavor

/** A flavor of the Camunda 7 REST dialect: every tool reaches its engines through their client. */
export type C7Flavor = { [F in Flavor]: (typeof FLAVORS)[F] extends "c7" ? F : never }[Flavor]

/**
 * A dialect the server reads through the engine contract alone (`resolveRuntimeEngine`): boards
 * and diagrams read it, every Camunda 7 path refuses it (ENGINE_DIALECT_NOT_SERVED).
 */
export type ContractDialect = Exclude<Dialect, "c7">

/**
 * How the server signs in to an engine: not at all, Basic, a fixed bearer token, the MCP
 * caller's own bearer token passed through, or a token of the client credentials grant, which a
 * Camunda 8 cluster reads (`src/lib/engine/credentials.ts`).
 */
export type EngineAuthType = "basic" | "bearer" | "passthrough" | "none" | "clientCredentials"

/** How one engine signs in, resolved from its profile at boot (the secret read from its variable). */
export interface EngineAuth {
  type: EngineAuthType
  username?: string
  password?: string
  token?: string
  /** clientCredentials: the URL that issues the tokens, the client and its secret. */
  tokenEndpoint?: string
  clientId?: string
  clientSecret?: string
  /** clientCredentials: what the client asks a token for, sent as written. */
  audience?: string
  scopes?: readonly string[]
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
  /** Engine vendor; selects the provider, and with it the dialect. Default: "camunda7". */
  flavor?: EngineFlavor
  /** Absent: no credentials. */
  auth?: EngineAuth
  /** The profile's `readOnly`: no tool writes to this engine (ENGINE_READ_ONLY). */
  readOnly?: boolean
  /** The profile's `timeout` in ms; it beats `ENGINE_REQUEST_TIMEOUT_MS`. */
  timeoutMs?: number
}

/** An engine of the Camunda 7 REST dialect: its flavor one of that dialect's, or none. */
export type C7EngineEntry = EngineEntry & { flavor?: C7Flavor }

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

/** What every provider says: its vendor, the dialect it speaks, its web app's links and its name. */
interface ProviderParts {
  flavor: EngineFlavor
  dialect: Dialect
  cockpit: EngineCockpitStrategy
  branding: { displayName: string }
}

/** A vendor of the Camunda 7 REST dialect: it also builds an engine's client (the client hook). */
export interface C7EngineProvider extends ProviderParts {
  flavor: C7Flavor
  dialect: "c7"
  /** REST-client factory, identical across vendors today; the hook exists for real divergence. */
  createClient(entry: EngineEntry, auth: EngineAuth, settings?: EngineClientSettings): Client
}

/** A vendor of a dialect the server reads through the engine contract: no client of its own. */
export interface ContractEngineProvider extends ProviderParts {
  flavor: Exclude<EngineFlavor, C7Flavor>
  dialect: ContractDialect
}

export type EngineProvider = C7EngineProvider | ContractEngineProvider
