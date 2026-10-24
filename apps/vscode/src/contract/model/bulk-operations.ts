import type { BulkOperationId, InstanceId, IsoTimestamp } from "./ids.js"

export type BulkOperationKind = "cancelInstances" | "migrateInstances"

export type BulkOperationState = "running" | "suspended" | "ended"

export interface BulkOperation {
  readonly id: BulkOperationId
  readonly kind: BulkOperationKind
  readonly state: BulkOperationState
  readonly total?: number
  readonly completed?: number
  readonly failed?: number
  readonly startedAt?: IsoTimestamp
  readonly endedAt?: IsoTimestamp
}

export interface BulkFailure {
  readonly instanceId?: InstanceId
  readonly reason: string
}
