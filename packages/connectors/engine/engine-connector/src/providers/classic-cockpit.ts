import type { EngineCockpitStrategy } from "../engine-provider.js"

/** Addressed by ID, not key+version; the classic cockpit has no `?tab=` deep links, so `tab` is ignored. */
export function classicCockpitStrategy(webappPath: string): EngineCockpitStrategy {
  return {
    deriveWebappBase: (baseUrl) =>
      baseUrl.endsWith("/engine-rest") ? baseUrl.replace(/\/engine-rest$/, webappPath) : null,
    processRoute: ({ definitionId }) =>
      definitionId ? `/#/process-definition/${encodeURIComponent(definitionId)}` : null,
    instanceRoute: ({ instanceId }) =>
      instanceId ? `/#/process-instance/${encodeURIComponent(instanceId)}` : null,
  }
}
