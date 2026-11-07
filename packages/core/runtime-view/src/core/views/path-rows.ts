import type { ElementRun, InstanceDetail } from "../../contract/index.js"
import type { PathRow, PathState } from "../protocol/index.js"
import { Labels } from "./labels.js"

export class PathRows {
  constructor(private readonly detail: InstanceDetail) {}

  rows(): PathRow[] {
    return this.detail.path.map((run) => this.rowOf(run))
  }

  private rowOf(run: ElementRun): PathRow {
    const duration = this.durationOf(run)
    return {
      elementId: run.elementId,
      startedAt: run.startedAt,
      state: this.stateOf(run),
      ...(run.elementName === undefined ? {} : { elementName: run.elementName }),
      ...(run.endedAt === undefined ? {} : { endedAt: run.endedAt }),
      ...(duration === undefined ? {} : { duration }),
    }
  }

  private stateOf(run: ElementRun): PathState {
    if (run.endedAt === undefined) {
      return "active"
    }
    return run.canceled ? "canceled" : "completed"
  }

  private durationOf(run: ElementRun): string | undefined {
    if (run.endedAt === undefined) {
      return undefined
    }
    const milliseconds = Date.parse(run.endedAt) - Date.parse(run.startedAt)
    return Number.isNaN(milliseconds) ? undefined : Labels.duration(milliseconds)
  }
}
