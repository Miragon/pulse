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
    if (counts === null || HistoryGaps.narrowed(filter)) {
      return undefined
    }
    return HistoryGaps.between(
      version.running,
      counts.all,
      counts.atLeast?.includes("all") === true,
    )
  }

  static between(running: number, counted: number, atLeast: boolean): HistoryGapData | undefined {
    return !atLeast && counted < running ? { running, counted } : undefined
  }

  private static narrowed({ elementId, businessKey, variables }: InstanceListFilterData): boolean {
    return elementId !== undefined || businessKey !== undefined || variables !== undefined
  }
}
