import type { EngineFilterInput } from "@miragon/pulse-analytics-client"

/**
 * A Prometheus is often shared across teams, so analytics reads only the server's
 * CONFIGURED engine ids; with none it is FAIL-CLOSED instead of reading everything.
 */
export interface AnalyticsEngineScope {
  readonly ids: readonly string[]
  /** Throws on an unknown id. */
  resolve(requested: EngineFilterInput): string[]
  /** `field` names the argument in the refusal. */
  require(id: string, field: string): string
  coversFleet(resolved: readonly string[]): boolean
}

/** So no query ever runs unscoped against a shared Prometheus. */
export function withEngineScope<T extends { engine?: EngineFilterInput }>(
  scope: AnalyticsEngineScope,
  args: T,
): Omit<T, "engine"> & { engine: string[] } {
  return { ...args, engine: scope.resolve(args.engine) }
}

export const NO_ENGINE_SCOPE_MESSAGE =
  "Analytics covers no engine: this server configures no engine ids. Activate the camunda7 module (its configured engines scope analytics) or set ANALYTICS_ENGINE_IDS to the engine_id values analytics may read."

export function isFleetRequest(requested: EngineFilterInput): boolean {
  if (requested === undefined || requested === null) return true
  return (Array.isArray(requested) ? requested : [requested]).every((id) => id.length === 0)
}

export function createEngineScope(configured: readonly string[] | undefined): AnalyticsEngineScope {
  const ids = [...new Set((configured ?? []).map((id) => id.trim()).filter((id) => id.length > 0))]

  function assertConfigured(): void {
    if (ids.length === 0) throw new Error(NO_ENGINE_SCOPE_MESSAGE)
  }

  function refuseUnknown(unknown: string[], field: string): never {
    const list = unknown.map((id) => `"${id}"`).join(", ")
    throw new Error(
      `Unknown engine ${list} in ${field} — analytics covers only this server's configured engines: ${ids.join(", ")}.`,
    )
  }

  return {
    ids,
    resolve(requested) {
      assertConfigured()
      if (isFleetRequest(requested)) return [...ids]
      const list = typeof requested === "string" ? [requested] : (requested ?? [])
      const named = [...new Set(list.filter((id) => id.length > 0))]
      const unknown = named.filter((id) => !ids.includes(id))
      if (unknown.length > 0) refuseUnknown(unknown, "engine")
      return named
    },
    require(id, field) {
      assertConfigured()
      if (!ids.includes(id)) refuseUnknown([id], field)
      return id
    },
    coversFleet(resolved) {
      return ids.length > 0 && ids.every((id) => resolved.includes(id))
    },
  }
}
