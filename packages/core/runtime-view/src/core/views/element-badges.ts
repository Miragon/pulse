import { DiagramBadges } from "@miragon/pulse-board/builder"
import type { ElementStatistics } from "@miragon/pulse-engine-core"
import type { ElementBadge } from "../protocol/index.js"

export class ElementBadges {
  static of(diagramXml: string, statistics: readonly ElementStatistics[]): ElementBadge[] {
    return ElementBadges.from(DiagramBadges.of(diagramXml, statistics))
  }

  static from(statistics: readonly ElementStatistics[]): ElementBadge[] {
    return statistics.map((statistic) => ({
      elementId: statistic.elementId,
      running: statistic.active,
      incidents: statistic.incidents,
      incidentsInCalledInstances: statistic.incidentsInCalledInstances,
    }))
  }
}
