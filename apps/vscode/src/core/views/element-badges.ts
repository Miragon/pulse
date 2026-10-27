import type { ElementStatistics } from "../../contract/index.js"
import { BpmnStructure } from "../bpmn/bpmn-structure.js"
import type { ElementBadge } from "../protocol/index.js"
import { SubProcessRollUp } from "./sub-process-roll-up.js"

export class ElementBadges {
  static of(diagramXml: string, statistics: readonly ElementStatistics[]): ElementBadge[] {
    const structure = BpmnStructure.of(diagramXml)
    return SubProcessRollUp.statistics(statistics, structure)
      .filter(
        (statistic) =>
          statistic.active + statistic.incidents + statistic.incidentsInCalledInstances > 0,
      )
      .map((statistic) => ({
        elementId: statistic.elementId,
        running: statistic.active,
        incidents: statistic.incidents,
        incidentsInCalledInstances: statistic.incidentsInCalledInstances,
      }))
  }
}
