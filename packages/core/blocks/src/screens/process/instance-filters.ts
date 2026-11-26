import type {
  InstanceListFilterData,
  InstanceScopeCode,
  VariableConditionData,
} from "@miragon/pulse-screens"

interface FilterParts {
  readonly scope: InstanceScopeCode
  readonly elementId?: string | undefined
  readonly businessKey?: string | undefined
  readonly variables?: readonly VariableConditionData[] | undefined
}

/** The filter of an instance list without the parts that filter nothing (an empty key or list). */
function composed({
  scope,
  elementId,
  businessKey,
  variables,
}: FilterParts): InstanceListFilterData {
  return {
    scope,
    ...(elementId === undefined ? {} : { elementId }),
    ...(businessKey === undefined || businessKey === "" ? {} : { businessKey }),
    ...(variables === undefined || variables.length === 0 ? {} : { variables }),
  }
}

/**
 * The filters a process's instance list asks for, each from the one it shows: another scope, an
 * element (a badge's click) or none, the exact business key, a variable condition added, replaced
 * or removed. Pure, for the filter bar and a surface's own controls (a badge, Escape).
 */
export class InstanceFilters {
  static withScope(filter: InstanceListFilterData, scope: InstanceScopeCode) {
    return composed({ ...filter, scope })
  }

  static withElement(filter: InstanceListFilterData, elementId: string, scope?: InstanceScopeCode) {
    return composed({ ...filter, elementId, scope: scope ?? filter.scope })
  }

  static withoutElement(filter: InstanceListFilterData) {
    return composed({ ...filter, elementId: undefined })
  }

  static withBusinessKey(filter: InstanceListFilterData, text: string) {
    return composed({ ...filter, businessKey: text.trim() })
  }

  /** Adds a condition, or replaces the one at `at`. */
  static withVariable(
    filter: InstanceListFilterData,
    condition: VariableConditionData,
    at?: number,
  ) {
    const variables = [...(filter.variables ?? [])]
    variables.splice(at ?? variables.length, at === undefined ? 0 : 1, condition)
    return composed({ ...filter, variables })
  }

  static withoutVariable(filter: InstanceListFilterData, at: number) {
    return composed({
      ...filter,
      variables: (filter.variables ?? []).filter((_condition, index) => index !== at),
    })
  }

  static withoutVariables(filter: InstanceListFilterData) {
    return composed({ ...filter, variables: undefined })
  }
}
