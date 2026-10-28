import { ElementId, type DefinitionId, type ElementStatistics } from "../../../contract/index.js"
import type { EngineClient } from "../engine-rest/index.js"
import { RootIncident } from "../mapping/root-incident.js"

interface ElementCounts {
  active: number
  incidents: number
  incidentsInCalledInstances: number
}

export class ElementStatisticsReader {
  constructor(private readonly client: EngineClient) {}

  async of(definitionId: DefinitionId): Promise<ElementStatistics[]> {
    const [activities, incidents] = await Promise.all([
      this.client.activityStatistics(definitionId),
      this.client.incidents({ processDefinitionId: definitionId }),
    ])
    const counts = new Map<string, ElementCounts>()
    for (const element of activities) {
      this.countsFor(counts, element.activityId).active = element.instances
    }
    for (const incident of incidents) {
      const element = this.countsFor(counts, incident.activityId)
      if (RootIncident.is(incident)) {
        element.incidents += 1
      } else {
        element.incidentsInCalledInstances += 1
      }
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
}
