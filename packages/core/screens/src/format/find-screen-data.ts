import type { HistoryGapData } from "./history-gaps.js"
import type { DefinitionRefData, InstanceStateCode } from "./instance-screen-data.js"

export interface FindHitData {
  readonly id: string
  readonly definition: DefinitionRefData
  readonly state: InstanceStateCode
  readonly hasIncident: boolean
  readonly businessKey?: string
  readonly startedAt?: string
  readonly endedAt?: string
}

export interface FindScreenData {
  readonly engine: string
  readonly asOf: string
  readonly hits: readonly FindHitData[]
  readonly cut: boolean
  readonly historyGap: HistoryGapData | null
}
