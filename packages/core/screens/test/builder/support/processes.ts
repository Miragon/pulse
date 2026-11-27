import {
  BpmnProcessId,
  DefinitionId,
  ElementId,
  type DefinitionRef,
  type ElementStatistics,
  type VersionSummary,
} from "@miragon/pulse-engine-core"
import type { ProcessFacts } from "../../../src/builder/index.js"

export class Processes {
  static readonly AS_OF = new Date("2026-11-19T09:00:00.000Z")

  static readonly ORDER = BpmnProcessId("order")

  static definition(version: number, name?: string): DefinitionRef {
    return {
      id: DefinitionId(`order:${String(version)}`),
      bpmnProcessId: Processes.ORDER,
      tenantId: null,
      version,
      ...(name === undefined ? {} : { name }),
    }
  }

  static version(
    version: number,
    running: number,
    withIncident: number,
    incidents = withIncident,
  ): VersionSummary {
    return { definition: Processes.definition(version, "Order"), running, withIncident, incidents }
  }

  static statistic(elementId: string, counts: Partial<ElementStatistics>): ElementStatistics {
    return {
      elementId: ElementId(elementId),
      active: 0,
      incidents: 0,
      incidentsInCalledInstances: 0,
      ...counts,
    }
  }

  static facts(changes: Partial<ProcessFacts> = {}): ProcessFacts {
    return {
      engine: "prod-a",
      asOf: Processes.AS_OF,
      bpmnProcessId: Processes.ORDER,
      tenantId: null,
      versions: [Processes.version(3, 1, 0), Processes.version(2, 4, 1)],
      selected: undefined,
      diagramXml: "<process />",
      statistics: [],
      calledProcesses: [],
      ...changes,
    }
  }
}
