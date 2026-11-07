import type { InstanceFilter } from "../../../contract/index.js"
import { Keys } from "../mapping/keys.js"
import { VariableFilters } from "../mapping/variable-filters.js"
import { Present, type SearchFilter } from "../rest/index.js"

export class InstanceFilters {
  static of(filter: InstanceFilter): SearchFilter | undefined {
    const variables = InstanceFilters.variablesOf(filter)
    const ids = filter.instanceIds === undefined ? undefined : Keys.only(filter.instanceIds)
    const unknownDefinition = filter.definitionId !== undefined && !Keys.isKey(filter.definitionId)
    if (ids?.length === 0 || unknownDefinition) {
      return undefined
    }
    return Present.fields({
      processDefinitionKey: filter.definitionId,
      processDefinitionId: filter.bpmnProcessId,
      endDate: InstanceFilters.endDateOf(filter),
      hasIncident: filter.withIncident,
      businessId: filter.businessKey,
      elementId: filter.activeElementId,
      elementInstanceState: filter.activeElementId === undefined ? undefined : "ACTIVE",
      processInstanceKey: ids === undefined ? undefined : { $in: ids },
      variables,
    })
  }

  private static variablesOf(filter: InstanceFilter): SearchFilter["variables"] {
    return filter.variables === undefined || filter.variables.length === 0
      ? undefined
      : VariableFilters.of(filter.variables)
  }

  private static endDateOf(filter: InstanceFilter): SearchFilter["endDate"] {
    if (filter.lifecycle === undefined) {
      return undefined
    }
    return { $exists: filter.lifecycle === "ended" }
  }
}
