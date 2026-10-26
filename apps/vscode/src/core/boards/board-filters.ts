import { BpmnProcessId, ElementId, type InstanceFilter } from "../../contract/index.js"
import type { InstanceListFilter } from "../protocol/index.js"
import type { BoardFilter } from "./board-definition.js"

export class BoardFilters {
  static query(filter: BoardFilter): InstanceFilter {
    return {
      lifecycle: filter.state,
      ...(filter.process === undefined ? {} : { bpmnProcessId: BpmnProcessId(filter.process) }),
      ...(filter.activeElement === undefined
        ? {}
        : { activeElementId: ElementId(filter.activeElement) }),
      ...(filter.withIncident === undefined ? {} : { withIncident: filter.withIncident }),
      ...(filter.businessKey === undefined ? {} : { businessKey: filter.businessKey }),
    }
  }

  static listFilter(filter: BoardFilter): InstanceListFilter | undefined {
    if (
      filter.withIncident === false ||
      (filter.withIncident === true && filter.state === "ended")
    ) {
      return undefined
    }
    const scope = filter.withIncident === true ? "withIncident" : filter.state
    return {
      scope,
      ...(filter.activeElement === undefined ? {} : { elementId: filter.activeElement }),
      ...(filter.businessKey === undefined ? {} : { businessKey: filter.businessKey }),
    }
  }

  static title(filter: BoardFilter): string {
    const parts = [
      filter.state === "running" ? "Running instances" : "Ended instances",
      filter.withIncident === true ? "with incident" : undefined,
      filter.withIncident === false ? "without incident" : undefined,
      filter.process === undefined ? undefined : `of ${filter.process}`,
      filter.activeElement === undefined ? undefined : `at ${filter.activeElement}`,
      filter.businessKey === undefined ? undefined : `with key ${filter.businessKey}`,
    ]
    return parts.filter((part) => part !== undefined).join(" ")
  }
}
