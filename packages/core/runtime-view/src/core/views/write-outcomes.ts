import type { IncidentRow, InstanceView, Notice, WaitRow } from "../protocol/index.js"
import { InstanceViewElements } from "./instance-view-elements.js"

export interface RetriedIncident {
  readonly row: IncidentRow
  readonly waitsAtItsElementBefore: readonly WaitRow[]
}

export class WriteOutcomes {
  static readonly RETRY_CHECK: Notice = {
    tone: "info",
    title: "Retried. Checking whether it runs through…",
    actions: [],
  }

  static retried(row: IncidentRow, before: InstanceView): RetriedIncident {
    const waitsAtItsElementBefore = before.waitStates.filter(
      (wait) => wait.elementId === row.elementId,
    )
    return { row, waitsAtItsElementBefore }
  }

  static afterRetry(retried: RetriedIncident, view: InstanceView, stillChecking = false): Notice {
    const before = retried.row
    const label = InstanceViewElements.nameOf(view, before.elementId)
    const again = WriteOutcomes.failedAgain(before, view)
    if (again !== undefined) {
      return {
        tone: "danger",
        title: `Failed again at ${label}.`,
        detail: again.rootCause ?? again.message,
        actions: [],
      }
    }
    if (WriteOutcomes.waitsAsBefore(retried, view)) {
      return {
        tone: "info",
        title: `Waiting at ${label} for the next attempt.`,
        detail: stillChecking
          ? "A worker or the job executor picks it up; Pulse keeps checking for a minute."
          : "Nothing changed within a minute. Refresh later to see the result.",
        actions: [],
      }
    }
    return { tone: "info", title: `Moved on from ${label}.`, actions: [] }
  }

  static isSettled(retried: RetriedIncident, view: InstanceView): boolean {
    const failed = WriteOutcomes.failedAgain(retried.row, view) !== undefined
    return failed || !WriteOutcomes.waitsAsBefore(retried, view)
  }

  static afterChange(name: string, view: InstanceView): Notice {
    const retryable = view.incidents.filter((row) => row.retryable === true)
    const [only] = retryable
    return {
      tone: "info",
      title: `Changed ${name}.`,
      actions:
        retryable.length === 1 && only !== undefined
          ? [{ kind: "retryIncident", label: "Retry now", incidentId: only.id }]
          : [],
    }
  }

  static shownIn(view: InstanceView, outcome: Notice | undefined): InstanceView {
    return outcome === undefined ? view : { ...view, outcome }
  }

  private static waitsAsBefore(retried: RetriedIncident, view: InstanceView): boolean {
    const { row, waitsAtItsElementBefore } = retried
    const sameKindSinceTheSameInstant = (wait: WaitRow) =>
      waitsAtItsElementBefore.some(
        (was) => was.kindLabel === wait.kindLabel && was.since === wait.since,
      )
    return view.waitStates.some(
      (wait) => wait.elementId === row.elementId && sameKindSinceTheSameInstant(wait),
    )
  }

  private static failedAgain(before: IncidentRow, view: InstanceView): IncidentRow | undefined {
    return view.incidents.find((row) => row.elementId === before.elementId && row.id !== before.id)
  }
}
