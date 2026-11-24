import type { Notice } from "./notices.js"
import type { EngineBadge } from "./view-models.js"

export interface PlanSideView {
  readonly definitionId: string
  readonly version: number
  readonly diagramXml: string
}

export interface PlanMappingRow {
  readonly sourceElementId: string
  readonly sourceLabel: string
  readonly targetElementId?: string
  readonly targetLabel?: string
  readonly tokens?: number
  readonly refused?: string
  readonly problem?: string
  readonly warning?: string
  readonly unmappedTokens?: true
}

export interface PlanVerdict {
  readonly fits: boolean
  readonly text: string
}

export interface MigrationPlanView {
  readonly kind: "migrationPlan"
  readonly engine: EngineBadge
  readonly asOf: string
  readonly fileName: string
  readonly processName: string
  readonly bpmnProcessId: string
  readonly source: PlanSideView
  readonly target: PlanSideView
  readonly running: number
  readonly withIncident: number
  readonly rows: readonly PlanMappingRow[]
  readonly focused?: string
  readonly summary: string
  readonly verdict: PlanVerdict
  readonly facts: readonly string[]
  readonly notices: readonly Notice[]
}
