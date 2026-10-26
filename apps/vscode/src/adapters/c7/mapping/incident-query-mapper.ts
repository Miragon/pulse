import type { IncidentFilter } from "../../../contract/index.js"
import type { IncidentQuery } from "../engine-cli/index.js"
import type { Mapper } from "./mapper.js"

export class IncidentQueryMapper implements Mapper<IncidentFilter, IncidentQuery> {
  map(filter: IncidentFilter): IncidentQuery {
    return {
      ...(filter.definitionId === undefined ? {} : { processDefinitionId: filter.definitionId }),
      ...(filter.bpmnProcessId === undefined
        ? {}
        : { processDefinitionKeyIn: [filter.bpmnProcessId] }),
      ...(filter.instanceId === undefined ? {} : { processInstanceId: filter.instanceId }),
    }
  }
}
