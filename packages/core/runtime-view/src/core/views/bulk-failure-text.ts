import type { BulkFailure, InstanceSummary } from "../../contract/index.js"
import type { BulkRun } from "../panels/bulk-run.js"
import { Labels } from "./labels.js"

const READ_AT_MOST = 100

export class BulkFailureText {
  private readonly stillThere: ReadonlyMap<string, InstanceSummary>

  constructor(
    private readonly run: BulkRun,
    stillThere: readonly InstanceSummary[],
  ) {
    this.stillThere = new Map(stillThere.map((instance) => [instance.id, instance]))
  }

  static titleOf(run: BulkRun): string {
    const failed = Labels.plural(run.progress.failed, "instance")
    return `Why ${failed} could not be ${run.plan.action.wording.done}`
  }

  text(): string {
    const failures = this.run.failures ?? []
    const { failed, total } = this.run.progress
    const header = `Bulk operation ${this.run.operationId ?? ""}: ${failed} of ${total} failed.`
    const more =
      failures.length >= READ_AT_MOST ? [`Pulse read the first ${READ_AT_MOST} failures.`] : []
    return [header, "", ...failures.map((failure) => this.lineOf(failure)), ...more].join("\n")
  }

  private lineOf(failure: BulkFailure): string {
    const { instanceId } = failure
    if (instanceId === undefined || !this.run.plan.ids.includes(instanceId)) {
      return `- ${failure.reason}`
    }
    const instance = this.stillThere.get(instanceId)
    if (instance === undefined) {
      return `- ${instanceId}: ended meanwhile (${failure.reason})`
    }
    const key = instance.businessKey === undefined ? "" : `${instance.businessKey} `
    return `- ${key}${instanceId}: ${failure.reason}`
  }
}
