import type { BoardFilter } from "@miragon/pulse-board"
import type { InstanceListFilter } from "../protocol/index.js"

export class BoardFilters {
  static listFilter(filter: BoardFilter): InstanceListFilter | undefined {
    if (filter.withIncident === false) {
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
