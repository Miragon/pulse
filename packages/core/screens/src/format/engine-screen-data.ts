export interface EngineInfoData {
  readonly product: string
  readonly version: string
}

export interface ProcessRowData {
  readonly bpmnProcessId: string
  readonly tenantId?: string
  readonly name?: string
  readonly latestVersion: number
  readonly running: number
  readonly withIncident: number
  readonly incidents: number
  readonly incidentsAtLeast?: true
}

export interface EngineTotalsData {
  readonly processes: number
  readonly running: number
  readonly withIncident: number
}

export interface EngineScreenData {
  readonly engine: string
  readonly asOf: string
  readonly info: EngineInfoData | null
  readonly processes: readonly ProcessRowData[]
  readonly totals: EngineTotalsData
}
