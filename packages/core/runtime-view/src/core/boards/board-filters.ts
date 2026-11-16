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
}
