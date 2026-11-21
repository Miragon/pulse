import type { FindScreenData } from "../format/find-screen-data.js"
import type { HistoryGapData } from "../format/history-gaps.js"
import type { InstanceStateCode } from "../format/instance-screen-data.js"

type HitFigure = readonly [string | null, string, number, InstanceStateCode, boolean, boolean]

export interface FindFiguresData {
  readonly hits: readonly HitFigure[]
  readonly cut: boolean
  readonly historyGap: HistoryGapData | null
}

export class FindFigures {
  static of(data: FindScreenData): FindFiguresData {
    return {
      hits: data.hits.map(({ businessKey, definition, state, hasIncident, endedAt }) => [
        businessKey ?? null,
        definition.bpmnProcessId,
        definition.version,
        state,
        hasIncident,
        endedAt !== undefined,
      ]),
      cut: data.cut,
      historyGap: data.historyGap,
    }
  }
}
