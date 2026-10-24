import { ElementId, type ElementStatistics } from "../../../contract/index.js"
import type { ActivityStatisticsView, IncidentView } from "../engine-cli/index.js"
import type { Mapper } from "./mapper.js"
import { RootIncident } from "./root-incident.js"

export interface ElementActivity {
  readonly activities: readonly ActivityStatisticsView[]
  readonly incidents: readonly IncidentView[]
}

interface ElementCounts {
  active: number
  incidents: number
  incidentsInCalledInstances: number
}

export class ElementStatisticsMapper implements Mapper<ElementActivity, ElementStatistics[]> {
  map(activity: ElementActivity): ElementStatistics[] {
    const counts = new Map<string, ElementCounts>()
    for (const element of activity.activities) {
      this.countsFor(counts, element.activityId).active = element.instances
    }
    for (const incident of activity.incidents) {
      this.countIncident(counts, incident)
    }
    return [...counts.entries()].map(([activityId, elementCounts]) => ({
      elementId: ElementId(activityId),
      active: Math.max(0, elementCounts.active - elementCounts.incidents),
      incidents: elementCounts.incidents,
      incidentsInCalledInstances: elementCounts.incidentsInCalledInstances,
    }))
  }

  private countsFor(counts: Map<string, ElementCounts>, activityId: string): ElementCounts {
    const existing = counts.get(activityId)
    if (existing !== undefined) {
      return existing
    }
    const created = { active: 0, incidents: 0, incidentsInCalledInstances: 0 }
    counts.set(activityId, created)
    return created
  }

  private countIncident(counts: Map<string, ElementCounts>, incident: IncidentView): void {
    const element = this.countsFor(counts, incident.activityId)
    if (RootIncident.is(incident)) {
      element.incidents += 1
    } else {
      element.incidentsInCalledInstances += 1
    }
  }
}
