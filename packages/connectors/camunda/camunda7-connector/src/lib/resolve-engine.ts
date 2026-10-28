import {
  BackendNotSelectedError,
  UnknownBackendError,
  createBackendRegistry,
  type BackendRegistry,
} from "@miragon/mcp-toolkit-core/tools"
import { withCallerSignal, type Client } from "@miragon/pulse-camunda7-client"
import type { EngineProvider } from "../engine-provider.js"
import { providerForEntry } from "../providers/index.js"

// Re-exported so existing importers keep their path.
export type { EngineAuth, EngineEntry, EngineFlavor } from "../engine-provider.js"
import type { EngineEntry } from "../engine-provider.js"

export interface EngineMeta {
  baseUrl: string
  cockpitUrl?: string
  provider: EngineProvider
}

/** No in-memory selection state: it would break behind more than one replica; the durable equivalent is the caller's saved `defaultEngineId`. */
export interface EngineRegistry {
  backends: BackendRegistry<Client, EngineMeta>
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
  const backends = createBackendRegistry<Client, EngineMeta>(
    engines.map((e) => ({
      id: e.id,
      client: clientFor(e),
      // Throws on an unknown flavor: fail the boot rather than emit wrong cockpit links.
      meta: { baseUrl: e.baseUrl, cockpitUrl: e.cockpitUrl, provider: providerForEntry(e) },
    })),
    { label: "engine" },
  )
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
  constructor(
    availableEngines: EngineEntry[],
    { canSaveDefault = false, selector = "Pass `engine`" } = {},
  ) {
    const ids = availableEngines.map((e) => e.id).join(", ")
    super(
      `No engine specified and no default engine saved. ${selector} — one of: ${ids}.` +
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
): Promise<{
  client: Client
  engineId: string
  baseUrl: string
  cockpitUrl?: string
  provider: EngineProvider
}> {
  try {
    const backend = registry.backends.resolve(override ?? (await savedDefault(registry, call)))
    return {
      client: withCallerSignal(backend.client, call?.signal),
      engineId: backend.id,
      baseUrl: backend.meta?.baseUrl ?? "",
      cockpitUrl: backend.meta?.cockpitUrl,
      // Fallback only for registries built outside createEngineRegistry (tests).
      provider: backend.meta?.provider ?? providerForEntry({ id: backend.id }),
    }
  } catch (e) {
    if (e instanceof BackendNotSelectedError) {
      throw new EngineNotSelectedError(registry.engines, {
        canSaveDefault: registry.canSaveDefault?.(call) ?? false,
      })
    }
    if (e instanceof UnknownBackendError)
      throw new UnknownEngineError(e.requestedId, registry.engines)
    throw e
  }
}

export interface Camunda7StepAppConfig {
  registry: EngineRegistry
  engines: EngineEntry[]
}

/** Steps have no `engine` argument, so the error names the `camunda7:engine` view key instead. */
export async function resolveStepEngine(
  appConfig: Camunda7StepAppConfig,
  override?: string,
): Promise<{
  client: Client
  engineId: string
  baseUrl: string
  cockpitUrl?: string
  provider: EngineProvider
}> {
  try {
    return await resolveEngine(override, appConfig.registry)
  } catch (e) {
    if (e instanceof EngineNotSelectedError) {
      throw new EngineNotSelectedError(appConfig.registry.engines, {
        selector: "Set the `camunda7:engine` view key",
      })
    }
    throw e
  }
}
