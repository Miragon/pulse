import { withCallerSignal, type Client } from "@miragon/pulse-camunda7-client"
import type { EngineProvider } from "../engine-provider.js"
import { providerForEntry } from "../providers/index.js"

// Re-exported so existing importers keep their path.
export type { EngineAuth, EngineEntry, EngineFlavor } from "../engine-provider.js"
import type { EngineEntry } from "../engine-provider.js"

interface EngineBackend {
  client: Client
  baseUrl: string
  cockpitUrl?: string
  provider: EngineProvider
}

/** No in-memory selection state: it would break behind more than one replica; the durable equivalent is the caller's saved `defaultEngineId`. */
export interface EngineRegistry {
  /** Engine id to client, URLs and provider, in configuration order. */
  backends: ReadonlyMap<string, EngineBackend>
  engines: EngineEntry[]
  /** Advisory, must never throw; not consulted when only one engine is configured. */
  defaultEngineId?: (call?: EngineCallContext) => Promise<string | undefined>
  /** Gates the `camunda7_select_engine` hint: a hint the caller cannot follow costs a dead round trip. */
  canSaveDefault?: (call?: EngineCallContext) => boolean
}

export function createEngineRegistry(
  engines: EngineEntry[],
  clientFor: (engine: EngineEntry) => Client,
  opts?: Pick<EngineRegistry, "defaultEngineId" | "canSaveDefault">,
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
    })
  }
  return {
    backends,
    engines,
    defaultEngineId: opts?.defaultEngineId,
    canSaveDefault: opts?.canSaveDefault,
  }
}

/** Lists the engine ids in the message: only code + message reach the model, so this saves a `camunda7_list_engines` round trip. */
export class EngineNotSelectedError extends Error {
  readonly code = "ENGINE_NOT_SELECTED" as const
  readonly availableEngines: EngineEntry[]
  constructor(availableEngines: EngineEntry[], { canSaveDefault = false } = {}) {
    const ids = availableEngines.map((e) => e.id).join(", ")
    super(
      `No engine specified and no default engine saved. Pass \`engine\` — one of: ${ids}.` +
        (canSaveDefault
          ? " To route later calls without it, save a default with camunda7_select_engine."
          : ""),
    )
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

/** A stale stored id degrades to "no default" instead of failing every call. */
async function savedDefault(
  registry: EngineRegistry,
  call: EngineCallContext | undefined,
): Promise<string | undefined> {
  if (registry.engines.length <= 1) return undefined
  const id = await registry.defaultEngineId?.(call)
  return id && registry.engines.some((e) => e.id === id) ? id : undefined
}

/** mcp-use's handler `ctx` satisfies this structurally. */
export interface EngineCallContext {
  signal?: AbortSignal
  auth?: unknown
}

/**
 * Precedence: `override` > the caller's saved default > the only engine.
 * Pass the handler's `ctx` so reads abort with the MCP request (writes run to completion).
 */
export async function resolveEngine(
  override: string | undefined,
  registry: EngineRegistry,
  call?: EngineCallContext,
): Promise<EngineBackend & { engineId: string }> {
  const engineId = await pickEngineId(override, registry, call)
  const backend = registry.backends.get(engineId)
  if (!backend) throw new UnknownEngineError(engineId, registry.engines)
  return { ...backend, client: withCallerSignal(backend.client, call?.signal), engineId }
}

/** An empty `""` override counts as no engine named; it still skips the saved default. */
async function pickEngineId(
  override: string | undefined,
  registry: EngineRegistry,
  call: EngineCallContext | undefined,
): Promise<string> {
  const id = override ?? (await savedDefault(registry, call))
  if (id) return id
  const [only] = registry.engines
  if (only && registry.engines.length === 1) return only.id
  throw new EngineNotSelectedError(registry.engines, {
    canSaveDefault: registry.canSaveDefault?.(call) ?? false,
  })
}
