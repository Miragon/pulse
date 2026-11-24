export interface PlanSide {
  readonly version: number
}

export interface PlanMapping {
  readonly sourceElementId: string
  readonly targetElementId: string
}

export interface MigrationPlanDefinition {
  readonly bpmnProcessId: string
  readonly source: PlanSide
  readonly target: PlanSide
  readonly mappings: readonly PlanMapping[]
}

interface PlainProblem {
  readonly path: string
  readonly code:
    | "notJson"
    | "notAnObject"
    | "notAList"
    | "missing"
    | "notAProcessId"
    | "notAVersion"
    | "sameVersion"
    | "notAnElementId"
    | "enginePlan"
}

interface LimitProblem {
  readonly path: string
  readonly code: "tooLarge" | "tooManyMappings"
  readonly values: { readonly max: number }
}

interface ChoiceProblem {
  readonly path: string
  readonly code: "unknownKey"
  readonly values: { readonly choices: readonly string[] }
}

interface VersionProblem {
  readonly path: string
  readonly code: "unknownVersion"
  readonly values: { readonly found: string; readonly reads: number }
}

interface TwiceProblem {
  readonly path: string
  readonly code: "sourceTwice"
  readonly values: { readonly first: number }
}

interface ForeignProblem {
  readonly path: string
  readonly code: "notInAPlan"
  readonly values: { readonly key: string }
}

export type MigrationPlanProblem =
  PlainProblem | LimitProblem | ChoiceProblem | VersionProblem | TwiceProblem | ForeignProblem

export type MigrationPlanProblemCode = MigrationPlanProblem["code"]

export interface MigrationPlanNote {
  readonly path: string
  readonly code: "ignoredKey" | "schemaNotText"
}

export type MigrationPlanParse =
  | { readonly plan: MigrationPlanDefinition; readonly notes: readonly MigrationPlanNote[] }
  | { readonly problems: readonly MigrationPlanProblem[] }

export type VersionPick<T> =
  | { readonly kind: "found"; readonly candidate: T }
  | { readonly kind: "missing" }
  | { readonly kind: "ambiguous"; readonly count: number }
