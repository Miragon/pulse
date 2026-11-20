import type { InstanceListFilterData, ScopeCountsData } from "./instance-list-data.js"
import type { VersionData } from "./process-screen-data.js"

export interface HistoryGapData {
  readonly running: number
  readonly counted: number
}

export class HistoryGaps {
  static of(
    version: Pick<VersionData, "running">,
    filter: InstanceListFilterData,
    counts: ScopeCountsData | null,
  ): HistoryGapData | undefined {
    if (counts === null || HistoryGaps.narrowed(filter) || HistoryGaps.bounded(counts)) {
      return undefined
    }
    return counts.all < version.running
      ? { running: version.running, counted: counts.all }
      : undefined
  }

  private static narrowed({ elementId, businessKey, variables }: InstanceListFilterData): boolean {
    return elementId !== undefined || businessKey !== undefined || variables !== undefined
  }

  private static bounded(counts: ScopeCountsData): boolean {
    return counts.atLeast?.includes("all") === true
  }
}
