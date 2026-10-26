import type { BulkView } from "./bulk-views.js"
import type { Notice } from "./notices.js"
import type { EngineBadge, VersionOption } from "./view-models.js"

interface MigrationSide {
  readonly definitionId: string
  readonly version: number
  readonly diagramXml: string
}

export interface MappingCandidate {
  readonly elementId: string
  readonly label: string
}

export interface MappingRow {
  readonly sourceElementId: string
  readonly sourceLabel: string
  readonly candidates: readonly MappingCandidate[]
  readonly targetElementId?: string
  readonly problem?: string
  readonly waiting?: number
  readonly unmappedTokens?: true
  readonly warning?: string
}

export type MigrateOffer =
  | { readonly status: "ready"; readonly label: string }
  | { readonly status: "checking"; readonly label: string }
  | { readonly status: "refused"; readonly reason: string; readonly leaveOut?: string }
  | { readonly status: "pickTarget"; readonly reason: string }

export interface MigrationView {
  readonly kind: "migration"
  readonly engine: EngineBadge
  readonly asOf: string
  readonly processName: string
  readonly bpmnProcessId: string
  readonly source: MigrationSide
  readonly target?: MigrationSide
  readonly targets: readonly VersionOption[]
  readonly latestVersion: number
  readonly rows: readonly MappingRow[]
  readonly focused?: string
  readonly count: number
  readonly summary: string
  readonly offer: MigrateOffer
  readonly notices: readonly Notice[]
  readonly bulk?: BulkView
}
