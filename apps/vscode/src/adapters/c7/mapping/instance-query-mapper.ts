import type { InstanceFilter } from "../../../contract/index.js"
import { Present, type HistoricInstanceQuery } from "../engine-rest/index.js"
import type { Mapper } from "./mapper.js"
import { VariableConditionMapper } from "./variable-condition-mapper.js"

export class InstanceQueryMapper implements Mapper<InstanceFilter, HistoricInstanceQuery> {
  private readonly conditions = new VariableConditionMapper()

  map(filter: InstanceFilter): HistoricInstanceQuery {
    return Present.fields({
      processDefinitionId: filter.definitionId,
      processDefinitionKey: filter.bpmnProcessId,
      processInstanceIds: filter.instanceIds,
      processInstanceBusinessKey: filter.businessKey,
      unfinished: filter.lifecycle === "running" ? (true as const) : undefined,
      finished: filter.lifecycle === "ended" ? (true as const) : undefined,
      incidentStatus: filter.withIncident === true ? ("open" as const) : undefined,
      activityIdIn: filter.activeElementId === undefined ? undefined : [filter.activeElementId],
      variables: filter.variables?.map((condition) => this.conditions.map(condition)),
    })
  }
}
