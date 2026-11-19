import { BpmnProcessId, ElementId, type InstanceFilter } from "@miragon/pulse-engine-core"
import type { BoardFilter } from "../format/board-definition.js"

export class FilterQuery {
  static of(filter: BoardFilter): InstanceFilter {
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
}
