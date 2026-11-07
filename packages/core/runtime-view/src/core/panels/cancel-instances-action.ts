import type {
  BulkOperationId,
  InstanceFilter,
  InstanceId,
  InstanceSummary,
  ProcessCommands,
} from "../../contract/index.js"
import type { InstanceListFilter, OfferedBulkKind, ScopeCounts } from "../protocol/index.js"
import type { BulkWording, OfferedBulkAction } from "./bulk-action.js"

export class CancelInstancesAction implements OfferedBulkAction {
  readonly kind: OfferedBulkKind = "cancelInstances"
  readonly sendsReason = true
  readonly wording: BulkWording = {
    offer: "Cancel instances…",
    verb: "cancel",
    doing: "Cancelling",
    done: "cancelled",
    eligible: "running",
    skipped: "already ended",
    lasting: ["Called instances end with them.", "Can't be undone; Stop only halts the rest."],
    warning: "Cancelling can't be undone.",
    notDone: "The engine could not end them.",
    stalled:
      "The engine has not cancelled any more instances. Check that it runs its background jobs, then wait or stop.",
    reasonPrompt: "The engine keeps it with the cancelled instances. Pulse does not log it.",
  }

  eligible(instance: InstanceSummary): boolean {
    return instance.state === "running" || instance.state === "suspended"
  }

  eligibleFilter(filter: InstanceFilter): InstanceFilter {
    return { ...filter, lifecycle: "running" }
  }

  matching(filter: InstanceListFilter, counts: ScopeCounts): number {
    switch (filter.scope) {
      case "ended":
        return 0
      case "withIncident":
        return counts.withIncident
      default:
        return counts.running
    }
  }

  submit(
    commands: ProcessCommands,
    instanceIds: readonly InstanceId[],
    reason: string | undefined,
  ): Promise<BulkOperationId> {
    return commands.cancelInstances(instanceIds, reason === undefined ? {} : { reason })
  }
}
