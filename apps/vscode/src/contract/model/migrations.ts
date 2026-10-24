import type { DefinitionId, ElementId } from "./ids.js"

export interface ElementMapping {
  readonly sourceElementId: ElementId
  readonly targetElementId: ElementId
}

export interface MigrationPlan {
  readonly sourceDefinitionId: DefinitionId
  readonly targetDefinitionId: DefinitionId
  readonly mappings: readonly ElementMapping[]
}

export interface MigrationProblem {
  readonly mapping?: ElementMapping
  readonly message: string
}

export interface MigrationCheck {
  readonly problems: readonly MigrationProblem[]
}
