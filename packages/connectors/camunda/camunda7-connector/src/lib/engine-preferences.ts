import { readProfileAdvisory, type ProfileSource } from "@miragon/pulse-widget-shell/server"
import { resolveProfileKey } from "./resolve-profile-key.js"
import { parseCamunda7Settings, type Camunda7Settings } from "./profile-schema.js"
import {
  EngineNotSelectedError,
  resolveEngine,
  type EngineCallContext,
  type EngineEntry,
  type EngineRegistry,
} from "./resolve-engine.js"

// Single-sourced: a drift would let a user save a default they then cannot resolve.

/** Empty or stale allow-list means all: never lock a caller out. Curation, not security. */
export function allowedEngines(settings: Camunda7Settings, engines: EngineEntry[]): EngineEntry[] {
  const allowed = settings.allowedEngineIds
  if (!allowed || allowed.length === 0) return engines
  const filtered = engines.filter((e) => allowed.includes(e.id))
  return filtered.length > 0 ? filtered : engines
}

/** Never throws: a store outage reads as defaults, so no engine call fails on (or leaks the host of) the preferences database. */
export async function advisoryCamunda7Settings(
  store: ProfileSource,
  ctx?: unknown,
): Promise<Camunda7Settings> {
  return parseCamunda7Settings(await readProfileAdvisory(store, resolveProfileKey(ctx)))
}

/** Stale ids fail soft: a removed engine must not poison every later call. */
export async function profileDefaultEngineId(
  store: ProfileSource,
  engines: EngineEntry[],
  ctx?: unknown,
): Promise<string | undefined> {
  const settings = await advisoryCamunda7Settings(store, ctx)
  const id = settings.defaultEngineId
  return id && allowedEngines(settings, engines).some((e) => e.id === id) ? id : undefined
}

/** Opening on an engine the picker cannot show would strand the user. */
export class EngineNotAvailableError extends Error {
  readonly code = "ENGINE_NOT_AVAILABLE" as const
  constructor(requestedEngine: string, available: EngineEntry[]) {
    super(
      `Engine "${requestedEngine}" is not in this user's engine list (allowedEngineIds) — ` +
        `the cockpit offers: ${available.map((e) => e.id).join(", ")}. ` +
        "Open it on one of those, or pass `engine` to the camunda7 tools directly.",
    )
    this.name = "EngineNotAvailableError"
  }
}

/** Where the cockpit opens: the caller's engine list and the engine it lands on (null = the picker). */
export interface CockpitEngineScope {
  engines: EngineEntry[]
  engineId: string | null
}

/** Same precedence and same list as `camunda7_list_engines`, so bootstrap never names an engine the picker cannot show. Only "no engine selected" falls back. */
export async function cockpitEngineScope(
  store: ProfileSource,
  registry: EngineRegistry,
  override: string | undefined,
  call?: EngineCallContext,
): Promise<CockpitEngineScope> {
  const engines = allowedEngines(await advisoryCamunda7Settings(store, call), registry.engines)
  let engineId: string
  try {
    engineId = (await resolveEngine(override, registry, call)).engineId
  } catch (e) {
    // Only reachable without an override: several engines, no saved default.
    if (!(e instanceof EngineNotSelectedError)) throw e
    return { engines, engineId: engines.length === 1 ? engines[0].id : null }
  }
  if (!engines.some((e) => e.id === engineId)) throw new EngineNotAvailableError(engineId, engines)
  return { engines, engineId }
}
