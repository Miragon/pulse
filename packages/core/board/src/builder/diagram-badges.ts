import type { ElementId, ElementStatistics } from "@miragon/pulse-engine-core"
import { CollapsedShapes } from "./collapsed-shapes.js"

export class DiagramBadges {
  static of(diagramXml: string, statistics: readonly ElementStatistics[]): ElementStatistics[] {
    const shapes = CollapsedShapes.of(diagramXml)
    const rolled = new Map<string, ElementStatistics>(
      statistics.map((statistic) => [statistic.elementId, statistic]),
    )
    for (const inner of statistics) {
      for (const around of shapes.around(inner.elementId)) {
        const shape = rolled.get(around) ?? DiagramBadges.empty(around)
        rolled.set(around, {
          ...shape,
          incidents: shape.incidents + inner.incidents,
          incidentsInCalledInstances:
            shape.incidentsInCalledInstances + inner.incidentsInCalledInstances,
        })
      }
    }
    return [...rolled.values()].filter(
      (statistic) =>
        statistic.active + statistic.incidents + statistic.incidentsInCalledInstances > 0,
    )
  }

  private static empty(elementId: ElementId): ElementStatistics {
    return { elementId, active: 0, incidents: 0, incidentsInCalledInstances: 0 }
  }
}
