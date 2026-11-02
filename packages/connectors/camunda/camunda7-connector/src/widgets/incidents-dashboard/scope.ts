import type { IncidentsDashboardData } from "../../view-models.js"

/** From the data's echo, so the model re-queries the set the counts describe. */
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

/** One key, so the cockpit's two panels dedupe to one read of the route's engine. */
export function incidentsFeed(engine: string) {
  return { key: ["camunda7:incidents", engine], args: { engine } }
}
