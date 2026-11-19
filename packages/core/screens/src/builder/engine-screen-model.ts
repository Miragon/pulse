import type { DefinitionSummary, EngineInfo, ProcessRuntime } from "@miragon/pulse-engine-core"

export type EngineScreenReads = Pick<ProcessRuntime, "describeEngine" | "listDefinitions">

export interface EngineFacts {
  readonly engine: string
  readonly asOf: Date
  readonly definitions: readonly DefinitionSummary[]
  readonly info: EngineInfo | undefined
}

export interface EngineScreenTotals {
  readonly processes: number
  readonly running: number
  readonly withIncident: number
}

export interface EngineScreenModel {
  readonly engine: string
  readonly asOf: Date
  readonly info?: EngineInfo
  readonly processes: readonly DefinitionSummary[]
  readonly totals: EngineScreenTotals
}
