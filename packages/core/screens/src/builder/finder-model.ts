import type { InstanceSummary, Page, ProcessRuntime } from "@miragon/pulse-engine-core"
import type { HistoryGapData } from "../format/history-gaps.js"

export type FinderSearchReads = Pick<ProcessRuntime, "searchInstances">

export type FinderGapReads = Pick<ProcessRuntime, "countInstances" | "listDefinitions">

export type FinderReads = FinderSearchReads & FinderGapReads

export interface FindSearch {
  readonly asOf: Date
  readonly byId: Page<InstanceSummary>
  readonly byBusinessKey: Page<InstanceSummary>
}

export interface FindFacts extends FindSearch {
  readonly engine: string
  readonly historyGap: HistoryGapData | undefined
}

export interface FindModel {
  readonly engine: string
  readonly asOf: Date
  readonly hits: readonly InstanceSummary[]
  readonly cut: boolean
  readonly historyGap?: HistoryGapData
}
