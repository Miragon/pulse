import { ElementId, type ElementStatistics } from '../../contract/index.js';
import type { BpmnStructure } from '../bpmn/bpmn-structure.js';
import type { ElementMarker } from '../protocol/index.js';

export class SubProcessRollUp {
  static statistics(
    statistics: readonly ElementStatistics[],
    structure: BpmnStructure,
  ): ElementStatistics[] {
    const rolled = new Map<string, ElementStatistics>(
      statistics.map((statistic) => [statistic.elementId, statistic]),
    );
    for (const inner of statistics) {
      for (const around of structure.collapsedAround(inner.elementId)) {
        const shape = rolled.get(around) ?? SubProcessRollUp.empty(around);
        rolled.set(around, {
          ...shape,
          incidents: shape.incidents + inner.incidents,
          incidentsInCalledInstances:
            shape.incidentsInCalledInstances + inner.incidentsInCalledInstances,
        });
      }
    }
    return [...rolled.values()];
  }

  static markers(markers: readonly ElementMarker[], structure: BpmnStructure): ElementMarker[] {
    return markers.flatMap((marker) => [
      marker,
      ...structure
        .collapsedAround(marker.elementId)
        .map((elementId) => ({ elementId, kind: marker.kind })),
    ]);
  }

  private static empty(elementId: string): ElementStatistics {
    return {
      elementId: ElementId(elementId),
      active: 0,
      incidents: 0,
      incidentsInCalledInstances: 0,
    };
  }
}
