import type { ElementImplementation } from "../model/local-sources.js"

export interface ImplementationRule {
  readonly kind: ElementImplementation["kind"]
  readonly property: string
  readonly extension?: string
  readonly when?: { readonly property: string; readonly equals: string }
}

export interface MappingRule {
  readonly container: string
  readonly inputs: string
  readonly outputs: string
  readonly target: string
  readonly source: string
}

export interface BpmnDialect {
  readonly descriptor: { readonly uri: string }
  readonly fallback: boolean
  readonly implementations: readonly ImplementationRule[]
  readonly mappings: readonly MappingRule[]
  readonly errorDefinitions: readonly string[]
  readonly workerMarkers: readonly string[]
}
