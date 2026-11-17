import type { BoardFilter, IncidentSummaryRowData, ProcessDiagramData } from "@miragon/pulse-board"
import type { BoardInstancesTarget, BoardScope, BoardSlots, BoardTarget } from "./slots.js"

/** `target` where the surface opens it (`BoardSlots.opens`), else nothing to offer. */
export function openable<T extends BoardTarget>(
  slots: Pick<BoardSlots, "opens">,
  target: T | undefined,
): T | undefined {
  return target === undefined || slots.opens?.(target) === false ? undefined : target
}

/**
 * What an engine's count opens: the instances of its process, or of the engine without one. A
 * count of instances without an incident opens nothing, since no list shows only those.
 */
export function counterTarget(
  engine: string,
  filter: BoardFilter,
): BoardInstancesTarget | undefined {
  if (filter.withIncident === false) {
    return undefined
  }
  const scope: BoardScope = filter.withIncident === true ? "withIncident" : filter.state
  return {
    kind: "instances",
    engine,
    ...(filter.process === undefined ? {} : { bpmnProcessId: filter.process }),
    filter: {
      scope,
      ...(filter.activeElement === undefined ? {} : { elementId: filter.activeElement }),
      ...(filter.businessKey === undefined ? {} : { businessKey: filter.businessKey }),
    },
  }
}

/** What a summary row opens: the instances with incident of its process, or of its engine. */
export function summaryTarget(row: IncidentSummaryRowData): BoardInstancesTarget {
  return {
    kind: "instances",
    engine: row.engine,
    ...(row.process === undefined ? {} : { bpmnProcessId: row.process.bpmnProcessId }),
    filter: { scope: "withIncident" },
  }
}

/** What a diagram opens: the process, at an element when a count of it was chosen. */
export function diagramTarget(
  tile: ProcessDiagramData,
  scope: "running" | "withIncident",
  elementId: string | undefined,
): BoardInstancesTarget {
  return {
    kind: "instances",
    engine: tile.engine,
    bpmnProcessId: tile.widget.process,
    filter: { scope, ...(elementId === undefined ? {} : { elementId }) },
  }
}
