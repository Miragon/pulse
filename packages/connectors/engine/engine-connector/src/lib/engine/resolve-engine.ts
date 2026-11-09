import { withCallerSignal, type Client } from "@miragon/pulse-c7-client"
import type { EngineEntry } from "../../engine-provider.js"
import { providerForEntry } from "../../providers/index.js"
import type { EngineLink } from "./cockpit-url.js"

/** A configured engine: its address and provider (`EngineLink`), its client and its write gate. */
interface EngineBackend extends EngineLink {
  client: Client
  /** Its profile's `readOnly`: no tool writes to it. */
  readOnly: boolean
}

/** The engine a call runs on: its client (bound to the caller's signal), id, URLs and provider. */
export interface ResolvedEngine extends EngineLink {
  client: Client
  engineId: string
}

/** A profile the server refused, as a call to it learns: the id and why, never a value. */
export interface RefusedProfile {
  id: string
  /** Its environment, when its profile states one the parser took. */
  environment?: string
  reason: string
}

/** No in-memory selection state: it would break behind more than one replica; the operator sets `defaultEngineId` instead. */
export interface EngineRegistry {
  /** Engine id to client, URLs and provider, in configuration order. */
  backends: ReadonlyMap<string, EngineBackend>
  /** The usable engines, in configuration order. */
  engines: EngineEntry[]
  /** The refused profiles by engine id: a call to one fails with ENGINE_PROFILE_REFUSED. */
  refused: ReadonlyMap<string, RefusedProfile>
  /** Every configured engine id, refused ones included, in configuration order (the enum). */
  engineIds: readonly string[]
  /** Every profile, refused and nameless ones included: only one alone is the default. */
  profileCount: number
  /** `ENGINE_DEFAULT` or `defaultProfile`; the config already refused an id no profile carries. */
  defaultEngineId?: string
}

export interface EngineRegistryOptions {
  defaultEngineId?: string
  refused?: readonly RefusedProfile[]
  /** Default: the engines' ids, then the refused ones. */
  engineIds?: readonly string[]
  /** Default: the engines and the refused profiles. */
  profileCount?: number
}

export function createEngineRegistry(
  engines: EngineEntry[],
  clientFor: (engine: EngineEntry) => Client,
  opts: EngineRegistryOptions = {},
): EngineRegistry {
  // Programmer errors fail the boot, not the first call.
  if (engines.length === 0) throw new Error("createEngineRegistry needs at least one engine")
  const backends = new Map<string, EngineBackend>()
  for (const e of engines) {
    if (backends.has(e.id)) throw new Error(`createEngineRegistry: duplicate engine id "${e.id}"`)
    backends.set(e.id, {
      client: clientFor(e),
      baseUrl: e.baseUrl,
      cockpitUrl: e.cockpitUrl,
      // Throws on an unknown flavor: fail the boot rather than emit wrong cockpit links.
      provider: providerForEntry(e),
      readOnly: e.readOnly === true,
    })
  }
  const refused = new Map((opts.refused ?? []).map((profile) => [profile.id, profile]))
  return {
    backends,
    engines,
    refused,
    engineIds: opts.engineIds ?? [...backends.keys(), ...refused.keys()],
    profileCount: opts.profileCount ?? backends.size + refused.size,
    defaultEngineId: opts.defaultEngineId,
  }
}

/** Lists the engine ids in the message: only code + message reach the model, so this saves a `engine_list_engines` round trip. */
export class EngineNotSelectedError extends Error {
  readonly code = "ENGINE_NOT_SELECTED" as const
  readonly availableEngines: EngineEntry[]
  constructor(availableEngines: EngineEntry[]) {
    const ids = availableEngines.map((e) => e.id).join(", ")
    super(`No engine specified and no default engine configured. Pass \`engine\`, one of: ${ids}.`)
    this.name = "EngineNotSelectedError"
    this.availableEngines = availableEngines
  }
}

export class UnknownEngineError extends Error {
  readonly code = "UNKNOWN_ENGINE" as const
  readonly requestedEngine: string
  readonly availableEngines: EngineEntry[]
  constructor(requestedEngine: string, availableEngines: EngineEntry[]) {
    super(
      `Unknown engine id "${requestedEngine}". Available: ${availableEngines.map((e) => e.id).join(", ")}.`,
    )
    this.name = "UnknownEngineError"
    this.requestedEngine = requestedEngine
    this.availableEngines = availableEngines
  }
}

/**
 * A call to an engine whose profile the server refused: the reason names keys only, never a
 * value or a variable, so the model can tell the user what the operator has to fix.
 */
export class EngineProfileRefusedError extends Error {
  readonly code = "ENGINE_PROFILE_REFUSED" as const
  readonly engineId: string
  constructor({ id, reason }: RefusedProfile) {
    super(
      `Engine "${id}" is configured, but its profile cannot be used: ${reason} Ask the operator to fix it.`,
    )
    this.name = "EngineProfileRefusedError"
    this.engineId = id
  }
}

/** A write to an engine whose profile sets `readOnly`: refused before anything is sent. */
export class EngineReadOnlyError extends Error {
  readonly code = "ENGINE_READ_ONLY" as const
  readonly engineId: string
  constructor(engineId: string) {
    super(
      `Engine "${engineId}" is read-only on this server: its profile sets readOnly, so no tool writes to it. Nothing was sent.`,
    )
    this.name = "EngineReadOnlyError"
    this.engineId = engineId
  }
}

/** The SDK's handler `ctx` (`ServerContext`) satisfies this structurally. */
export interface EngineCallContext {
  mcpReq?: { signal?: AbortSignal }
}

/** An empty `""` override counts as no engine named; it still skips the default. */
function pickEngineId(override: string | undefined, registry: EngineRegistry): string {
  const id = override ?? registry.defaultEngineId
  if (id) return id
  // Counted with the refused profiles: a broken neighbour never reroutes to the other engine.
  const [only] = registry.engineIds
  if (only !== undefined && registry.profileCount === 1) return only
  throw new EngineNotSelectedError(registry.engines)
}

/** The engine a call goes to, never a refused one: precedence `override` > the default > the only one. */
function backendFor(
  override: string | undefined,
  registry: EngineRegistry,
): { engineId: string; backend: EngineBackend } {
  const engineId = pickEngineId(override, registry)
  const refused = registry.refused.get(engineId)
  if (refused) throw new EngineProfileRefusedError(refused)
  const backend = registry.backends.get(engineId)
  if (!backend) throw new UnknownEngineError(engineId, registry.engines)
  return { engineId, backend }
}

/**
 * Precedence: `override` > `ENGINE_DEFAULT` (or `defaultProfile`) > the only engine.
 * Pass the handler's `ctx` so reads abort with the MCP request (writes run to completion).
 */
export function resolveEngine(
  override: string | undefined,
  registry: EngineRegistry,
  call?: EngineCallContext,
): ResolvedEngine {
  const { engineId, backend } = backendFor(override, registry)
  const { baseUrl, cockpitUrl, provider } = backend
  return {
    baseUrl,
    cockpitUrl,
    provider,
    client: withCallerSignal(backend.client, call?.mcpReq?.signal),
    engineId,
  }
}

/** Throws ENGINE_READ_ONLY when the engine a write would go to has a read-only profile. */
export function assertWritable(override: string | undefined, registry: EngineRegistry): void {
  const { engineId, backend } = backendFor(override, registry)
  if (backend.readOnly) throw new EngineReadOnlyError(engineId)
}

/**
 * Where the cockpit opens: the engine every call would route to, or `null` for the picker (no
 * engine selected, or a refused one, which the picker shows). Any other error propagates.
 */
export function cockpitEngineId(
  override: string | undefined,
  registry: EngineRegistry,
): string | null {
  try {
    return resolveEngine(override, registry).engineId
  } catch (e) {
    if (e instanceof EngineNotSelectedError || e instanceof EngineProfileRefusedError) return null
    throw e
  }
}
