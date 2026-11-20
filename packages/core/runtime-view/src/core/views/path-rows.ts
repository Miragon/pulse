import type { PathRowData } from "@miragon/pulse-screens"
import type { PathRow } from "../protocol/index.js"
import { Labels } from "./labels.js"

export class PathRows {
  static of(path: readonly PathRowData[]): PathRow[] {
    return path.map(({ elementId, elementName, startedAt, endedAt, state, durationMs }) => ({
      elementId,
      startedAt,
      state,
      ...(elementName === undefined ? {} : { elementName }),
      ...(endedAt === undefined ? {} : { endedAt }),
      ...(durationMs === undefined
        ? {}
        : { duration: Labels.duration(durationMs), durationMs: Math.max(0, durationMs) }),
    }))
  }
}
