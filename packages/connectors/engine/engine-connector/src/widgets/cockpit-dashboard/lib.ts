import type { ToneVariant } from "@miragon/pulse-ui"
import { severityTone } from "@miragon/pulse-widget-shell/widgets"
import type { CockpitDashboardData, DefinitionStat } from "../../view-models.js"

export interface DefinitionRow extends DefinitionStat {
  totalIncidents: number
  tone: ToneVariant
}

export function buildRows(data: CockpitDashboardData): DefinitionRow[] {
  return data.definitions.map((def) => {
    const totalIncidents = def.incidents.reduce((s, i) => s + i.incidentCount, 0)
    return {
      ...def,
      totalIncidents,
      tone: severityTone(def.failedJobs, totalIncidents, def.instances),
    }
  })
}
