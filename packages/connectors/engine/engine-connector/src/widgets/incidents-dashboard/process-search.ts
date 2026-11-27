import type { IncidentsDashboardActivity, IncidentsDashboardProcess } from "../../view-models.js"

function matchesSearch(activity: IncidentsDashboardActivity, q: string): boolean {
  return (
    (activity.activityName ?? "").toLowerCase().includes(q) ||
    activity.activityId.toLowerCase().includes(q) ||
    (activity.representativeMessage ?? "").toLowerCase().includes(q)
  )
}

/** Whether the card's process is what `q` looks for: by its name, its key or its tenant. */
function processMatches(process: IncidentsDashboardProcess, q: string): boolean {
  return [process.processDefinitionName, process.processDefinitionKey, process.tenantId].some(
    (text) => (text ?? "").toLowerCase().includes(q),
  )
}

/** The search narrows the list, never the numbers: a sum over a partial scan would understate. */
export function filterProcesses(
  processes: IncidentsDashboardProcess[],
  search: string,
): IncidentsDashboardProcess[] {
  const q = search.trim().toLowerCase()
  return processes
    .map<IncidentsDashboardProcess | null>((p) => {
      if (q.length === 0 || processMatches(p, q)) return p
      const activities = p.activities.filter((a) => matchesSearch(a, q))
      return activities.length === 0 ? null : { ...p, activities }
    })
    .filter((p): p is IncidentsDashboardProcess => p !== null)
}

/** A card's id among the cards: its process's key and tenant, so a key's tenants are two cards. */
export function cardIdOf({ processDefinitionKey, tenantId }: IncidentsDashboardProcess): string {
  return JSON.stringify([processDefinitionKey, tenantId ?? null])
}
