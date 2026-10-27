import type {
  InstanceListFilter,
  InstanceScope,
  VariableConditionView,
} from "../../core/protocol/index.js"

export const SCOPE_OPTIONS: readonly { readonly scope: InstanceScope; readonly label: string }[] = [
  { scope: "running", label: "Running" },
  { scope: "withIncident", label: "With incident" },
  { scope: "ended", label: "Ended" },
  { scope: "all", label: "All" },
]

interface FilterParts {
  readonly scope: InstanceScope
  readonly elementId?: string | undefined
  readonly businessKey?: string | undefined
  readonly variables?: readonly VariableConditionView[] | undefined
}

export class InstanceFilter {
  static withScope(filter: InstanceListFilter, scope: InstanceScope): InstanceListFilter {
    return InstanceFilter.compose({ ...filter, scope })
  }

  static withElement(filter: InstanceListFilter, elementId: string): InstanceListFilter {
    return InstanceFilter.compose({ ...filter, elementId })
  }

  static withoutElement(filter: InstanceListFilter): InstanceListFilter {
    return InstanceFilter.compose({ ...filter, elementId: undefined })
  }

  static withBusinessKey(filter: InstanceListFilter, text: string): InstanceListFilter {
    return InstanceFilter.compose({ ...filter, businessKey: text.trim() })
  }

  static withVariable(
    filter: InstanceListFilter,
    condition: VariableConditionView,
    at?: number,
  ): InstanceListFilter {
    const variables = [...(filter.variables ?? [])]
    variables.splice(at ?? variables.length, at === undefined ? 0 : 1, condition)
    return InstanceFilter.compose({ ...filter, variables })
  }

  static withoutVariable(filter: InstanceListFilter, at: number): InstanceListFilter {
    const variables = (filter.variables ?? []).filter((_condition, index) => index !== at)
    return InstanceFilter.compose({ ...filter, variables })
  }

  static withoutVariables(filter: InstanceListFilter): InstanceListFilter {
    return InstanceFilter.compose({ ...filter, variables: undefined })
  }

  private static compose({
    scope,
    elementId,
    businessKey,
    variables,
  }: FilterParts): InstanceListFilter {
    return {
      scope,
      ...(elementId === undefined ? {} : { elementId }),
      ...(businessKey === undefined || businessKey === "" ? {} : { businessKey }),
      ...(variables === undefined || variables.length === 0 ? {} : { variables }),
    }
  }
}
