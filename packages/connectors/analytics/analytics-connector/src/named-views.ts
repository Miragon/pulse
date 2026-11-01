import type { AnalyticsDashboardData, EngineLandscapeResult } from "@miragon/pulse-analytics-client"
import type { NameLookup } from "./bpmn-name-lookup.js"
import type { Named } from "./bpmn-names.js"

// Keys in priority order: the lookup reads at most so many models per view.

/** Activity keys before the definition breakdown, so a low-volume bottleneck keeps its names. */
export async function namedDashboard(
  data: AnalyticsDashboardData,
  namesFor: NameLookup,
): Promise<Named<AnalyticsDashboardData>> {
  const keys = [
    ...(data.processDefinitionKey ? [data.processDefinitionKey] : []),
    ...data.activityBreakdown.map((a) => a.processDefinitionKey),
    ...data.definitionBreakdown.map((d) => d.processDefinitionKey),
  ]
  const elementIds = new Map<string, string[]>(keys.map((key) => [key, []]))
  for (const a of data.activityBreakdown) elementIds.get(a.processDefinitionKey)?.push(a.activityId)
  return {
    ...data,
    names: await namesFor(keys, {
      elementIds: Object.fromEntries(elementIds),
      engines: reportingInOrder(data.engines, data.reportingEngines),
    }),
  }
}

export async function namedLandscape(
  data: EngineLandscapeResult,
  namesFor: NameLookup,
): Promise<Named<EngineLandscapeResult>> {
  const keys = data.processes.map((p) => p.processDefinitionKey)
  return {
    ...data,
    names: await namesFor(keys, {
      elementIds: noElements(keys),
      enginesByKey: Object.fromEntries(
        data.processes.map((p) => [p.processDefinitionKey, p.engineIds]),
      ),
    }),
  }
}

function noElements(keys: readonly string[]): Record<string, string[]> {
  return Object.fromEntries(keys.map((key) => [key, []]))
}

/** A silent engine has no rows: the lookup reads the reporting engines in the scope's order. */
function reportingInOrder(
  engines: readonly string[] | null,
  reporting: readonly string[],
): readonly string[] {
  return engines ? engines.filter((id) => reporting.includes(id)) : reporting
}
