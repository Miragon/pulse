import type { CockpitRef, EngineProvider } from "../../engine-provider.js"

// Routes come from the provider; here only: an explicit `cockpitUrl` is the webapp BASE,
// only `http(s):` bases pass, and an unbuildable link is `null`, never a guessed URL.

/**
 * An engine's address and provider, what a link into its web app needs; the engine shapes of
 * `resolve-engine.ts` and `with-engine.ts` extend it.
 */
export interface EngineLink {
  baseUrl: string
  cockpitUrl?: string
  provider: EngineProvider
}

export interface CockpitUrlOptions {
  /** Cockpit tab to open by default (e.g. `"incidents"`, `"variables"`); flavors without tab deep-links ignore it. */
  tab?: string
}

export function tabSuffix(tab: string | undefined): string {
  return tab ? `?tab=${encodeURIComponent(tab)}` : ""
}

function resolveCockpitBase(engine: EngineLink): string | null {
  const base = engine.cockpitUrl?.trim() || engine.provider.cockpit.deriveWebappBase(engine.baseUrl)
  if (!base || !/^https?:/i.test(base)) return null
  return base.replace(/[/#]+$/, "")
}

/**
 * A web app's address as the profile writes it (`cockpitUrl`), trimmed, when it is http(s);
 * never derived from the engine's `url`. Null otherwise: a link is never guessed.
 */
export function webAppUrlOf(cockpitUrl: string | undefined): string | null {
  const url = cockpitUrl?.trim()
  return url && /^https?:\/\/\S/i.test(url) ? url : null
}

/**
 * An engine's own web app (its home): the base the provider's routes build on, the profile's
 * `cockpitUrl` or the one the provider derives from the REST root; null where none is known.
 */
export function buildEngineCockpitUrl(engine: EngineLink): string | null {
  return resolveCockpitBase(engine)
}

export function buildProcessCockpitUrl(
  engine: EngineLink,
  ref: CockpitRef,
  options?: CockpitUrlOptions,
): string | null {
  const base = resolveCockpitBase(engine)
  if (!base) return null
  const route = engine.provider.cockpit.processRoute(ref, options?.tab)
  return route ? base + route : null
}

export function buildInstanceCockpitUrl(
  engine: EngineLink,
  ref: CockpitRef,
  options?: CockpitUrlOptions,
): string | null {
  const base = resolveCockpitBase(engine)
  if (!base) return null
  const route = engine.provider.cockpit.instanceRoute(ref, options?.tab)
  return route ? base + route : null
}
