import type { IncidentsDashboardData } from "../../view-models.js"

/** From the data's echo (standalone gets no props), so the model re-queries the set the counts describe. */
export function dashboardScope(filters: IncidentsDashboardData["filters"]): {
  processDefinitionKey?: string
  incidentType?: string
  filtered: boolean
} {
  const processDefinitionKey = filters.processDefinitionKey || undefined
  const incidentType = filters.incidentType || undefined
  return {
    processDefinitionKey,
    incidentType,
    filtered: processDefinitionKey !== undefined || incidentType !== undefined,
  }
}

/**
 * One key, so the cockpit's two panels dedupe. Standalone never fetches: the engine-only feed
 * cannot re-read a filtered dashboard, whose scope lives only in the echo.
 */
export function incidentsFeed(engine: string | undefined) {
  return {
    key: ["camunda7:incidents", engine ?? null],
    args: { engine },
    ready: !!engine,
  }
}
