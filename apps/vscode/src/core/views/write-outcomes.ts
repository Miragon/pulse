import type { IncidentRow, InstanceView, Notice } from "../protocol/index.js"
import { InstanceViewElements } from "./instance-view-elements.js"

export class WriteOutcomes {
  static readonly RETRY_CHECK: Notice = {
    tone: "info",
    title: "Retried. Checking whether it runs through…",
    actions: [],
  }

  static afterRetry(before: IncidentRow, view: InstanceView, stillChecking = false): Notice {
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
    if (view.waitStates.some((row) => row.elementId === before.elementId)) {
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

  static isSettled(before: IncidentRow, view: InstanceView): boolean {
    const waiting = view.waitStates.some((row) => row.elementId === before.elementId)
    return WriteOutcomes.failedAgain(before, view) !== undefined || !waiting
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

  private static failedAgain(before: IncidentRow, view: InstanceView): IncidentRow | undefined {
    return view.incidents.find((row) => row.elementId === before.elementId && row.id !== before.id)
  }
}
