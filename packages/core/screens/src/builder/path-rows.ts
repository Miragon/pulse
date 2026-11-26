import type { InstanceDetail, IsoTimestamp } from "@miragon/pulse-engine-core"
import type { PathRowModel } from "./instance-screen-model.js"

export class PathRows {
  static of(detail: InstanceDetail): PathRowModel[] {
    return detail.path.map((run) =>
      run.endedAt === undefined
        ? { run, state: "active", durationMs: undefined }
        : {
            run,
            state: run.canceled ? "canceled" : "completed",
            durationMs: PathRows.between(run.startedAt, run.endedAt),
          },
    )
  }

  private static between(startedAt: IsoTimestamp, endedAt: IsoTimestamp): number | undefined {
    const milliseconds = Date.parse(endedAt) - Date.parse(startedAt)
    return Number.isNaN(milliseconds) ? undefined : Math.max(0, milliseconds)
  }
}
