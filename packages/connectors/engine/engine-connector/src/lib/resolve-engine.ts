import { withCallerSignal, type Client } from "@miragon/pulse-engine-client"
import type { EngineEntry, EngineProvider } from "../engine-provider.js"
import { providerForEntry } from "../providers/index.js"

interface EngineBackend {
  client: Client
  baseUrl: string
  cockpitUrl?: string
  provider: EngineProvider
}

/** No in-memory selection state: it would break behind more than one replica; the operator sets `defaultEngineId` instead. */
export interface EngineRegistry {
  /** Engine id to client, URLs and provider, in configuration order. */
  backends: ReadonlyMap<string, EngineBackend>
  engines: EngineEntry[]
  /** `ENGINE_DEFAULT`; the config schema already refused an id no engine carries. */
  defaultEngineId?: string
}

export function createEngineRegistry(
  engines: EngineEntry[],
  clientFor: (engine: EngineEntry) => Client,
  opts?: Pick<EngineRegistry, "defaultEngineId">,
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
  return { backends, engines, defaultEngineId: opts?.defaultEngineId }
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

/** mcp-use's handler `ctx` satisfies this structurally. */
export interface EngineCallContext {
  signal?: AbortSignal
}

/**
 * Precedence: `override` > `ENGINE_DEFAULT` > the only engine.
 * Pass the handler's `ctx` so reads abort with the MCP request (writes run to completion).
 */
export function resolveEngine(
  override: string | undefined,
  registry: EngineRegistry,
  call?: EngineCallContext,
): EngineBackend & { engineId: string } {
  const engineId = pickEngineId(override, registry)
  const backend = registry.backends.get(engineId)
  if (!backend) throw new UnknownEngineError(engineId, registry.engines)
  return { ...backend, client: withCallerSignal(backend.client, call?.signal), engineId }
}

/** An empty `""` override counts as no engine named; it still skips the default. */
function pickEngineId(override: string | undefined, registry: EngineRegistry): string {
  const id = override ?? registry.defaultEngineId
  if (id) return id
  const [only] = registry.engines
  if (only && registry.engines.length === 1) return only.id
  throw new EngineNotSelectedError(registry.engines)
}

/** Where the cockpit opens: the engine every call would route to, or `null` for the picker. Any error but "no engine selected" propagates. */
export function cockpitEngineId(
  override: string | undefined,
  registry: EngineRegistry,
): string | null {
  try {
    return resolveEngine(override, registry).engineId
  } catch (e) {
    if (e instanceof EngineNotSelectedError) return null
    throw e
  }
}
