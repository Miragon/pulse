import type { CockpitDashboardData, DefinitionStat } from "../../view-models.js"

export interface DefinitionRow extends DefinitionStat {
  totalIncidents: number
}

export function buildRows(data: CockpitDashboardData): DefinitionRow[] {
  return data.definitions.map((def) => ({
    ...def,
    totalIncidents: def.incidents.reduce((s, i) => s + i.incidentCount, 0),
  }))
}
