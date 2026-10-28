import { PERIODS, type PrometheusClient, type Period } from "@miragon/pulse-analytics-client"
import type { AnalyticsEngineScope } from "../engine-ids.js"
import type { ProfileSource } from "../server-locale.js"
import { settingsFor } from "../settings.js"
import type { NameLookup } from "../bpmn-name-lookup.js"

/** What the analytics plugin hands its pipeline steps (`appConfig` in `plugin.ts`). */
export interface AnalyticsAppConfig {
  client: PrometheusClient
  /** The server's configured engine ids — a step never reads an engine outside them. */
  engineScope: AnalyticsEngineScope
  /** The shared profile store — the source of the caller's saved analytics defaults. */
  profileStore?: ProfileSource
  /** The process names behind the ids, the same lookup the tools use (absent → ids). */
  namesFor?: NameLookup
}

/*
 * Step keys arrive unchecked from render-view, so each reader refuses a malformed value naming its
 * key, never reads it as omitted (that would widen to the whole fleet or swap in a default period).
 */

/** The optional `analytics:engine` scoping key both steps read. */
export const ENGINE_KEY_DECLARATION = {
  key: "analytics:engine",
  description:
    "Engine id, or a list of ids, to scope to (one of the server's configured engines). When omitted, every configured engine is aggregated — the result's `engines` names them.",
}

/** The step's `analytics:engine` key resolved to configured ids (omitted = all of them). */
export function stepEngines(
  keys: Record<string, unknown>,
  engineScope: AnalyticsEngineScope,
): string[] {
  const raw = keys[ENGINE_KEY_DECLARATION.key]
  const wellFormed =
    raw === undefined ||
    typeof raw === "string" ||
    (Array.isArray(raw) && raw.every((id) => typeof id === "string"))
  if (!wellFormed) {
    throw new Error(
      `${ENGINE_KEY_DECLARATION.key} must be an engine id or a list of engine ids — omit it to cover every configured engine.`,
    )
  }
  return engineScope.resolve(raw)
}

/**
 * The key, else the caller's saved default (from the ambient request: a step gets no handler ctx),
 * else the module default.
 */
export async function stepPeriod(
  keys: Record<string, unknown>,
  profileStore: ProfileSource | undefined,
): Promise<Period> {
  const raw = keys["analytics:period"]
  if (raw === undefined) return (await settingsFor(profileStore)).defaultPeriod
  if (PERIODS.includes(raw as Period)) return raw as Period
  throw new Error(
    `analytics:period must be one of ${PERIODS.join(", ")} — omit it for the caller's saved default.`,
  )
}

/** The step's optional `analytics:processDefinitionKey` (omitted = every process). */
export function stepProcessKey(keys: Record<string, unknown>): string | undefined {
  const raw = keys["analytics:processDefinitionKey"]
  if (raw === undefined || typeof raw === "string") return raw
  throw new Error(
    "analytics:processDefinitionKey must be a process definition key (a string) — omit it to cover every process.",
  )
}
