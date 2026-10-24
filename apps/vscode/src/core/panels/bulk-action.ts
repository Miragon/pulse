import type {
  BulkOperationId,
  InstanceFilter,
  InstanceId,
  InstanceSummary,
  ProcessCommands,
} from "../../contract/index.js"
import type {
  BulkKind,
  InstanceListFilter,
  OfferedBulkKind,
  ScopeCounts,
} from "../protocol/index.js"

export interface BulkWording {
  readonly offer: string
  readonly verb: string
  readonly doing: string
  readonly done: string
  readonly eligible: string
  readonly skipped: string
  readonly lasting: readonly string[]
  readonly warning: string
  readonly notDone: string
  readonly stalled: string
  readonly reasonPrompt: string
  readonly arrival?: string
}

export interface BulkAction {
  readonly kind: BulkKind
  readonly wording: BulkWording
  readonly sendsReason: boolean
  eligible(instance: InstanceSummary): boolean
  eligibleFilter(filter: InstanceFilter): InstanceFilter
  arrivedFilter?(filter: InstanceFilter): InstanceFilter
  matching(filter: InstanceListFilter, counts: ScopeCounts): number
  submit(
    commands: ProcessCommands,
    instanceIds: readonly InstanceId[],
    reason: string | undefined,
  ): Promise<BulkOperationId>
}

export interface OfferedBulkAction extends BulkAction {
  readonly kind: OfferedBulkKind
}
