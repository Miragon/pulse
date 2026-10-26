import type { Notice } from "./notices.js"

export type BulkKind = "cancelInstances" | "migrateInstances"

export type OfferedBulkKind = Exclude<BulkKind, "migrateInstances">

export type BulkStatus =
  "submitting" | "running" | "stalled" | "stopping" | "stopped" | "finished" | "failed" | "unknown"

export interface BulkProgress {
  readonly total: number
  readonly done: number
  readonly failed: number
}

export interface BulkView {
  readonly status: BulkStatus
  readonly notice: Notice
  readonly progress: BulkProgress
  readonly announcement: string
}

export interface BulkOffer {
  readonly action: OfferedBulkKind
  readonly label: string
}

export interface SelectionView {
  readonly count: number
  readonly eligible: string
  readonly allMatching: boolean
  readonly matching?: number
  readonly overCap?: number
  readonly cap: number
  readonly offers: readonly BulkOffer[]
  readonly migration?: string
  readonly blockedBy?: string
}
