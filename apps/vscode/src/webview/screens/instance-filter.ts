import type { InstanceListFilter, InstanceScope } from "../../core/protocol/index.js"

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

  private static compose({ scope, elementId, businessKey }: FilterParts): InstanceListFilter {
    return {
      scope,
      ...(elementId === undefined ? {} : { elementId }),
      ...(businessKey === undefined || businessKey === "" ? {} : { businessKey }),
    }
  }
}
