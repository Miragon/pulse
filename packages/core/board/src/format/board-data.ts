import type {
  CounterWidget,
  IncidentListWidget,
  IncidentSummaryWidget,
  InstanceListWidget,
  ProcessDiagramWidget,
} from "./board-definition.js"
import type { BoardProblem } from "./board-problems.js"

export type ProblemData = BoardProblem

export interface FailureData {
  readonly code: string
  readonly message?: string
}

export interface EngineTotalsData {
  readonly running: number
  readonly withIncident: number
}

export type EngineData =
  | { readonly name: string; readonly state: "notConfigured" }
  | { readonly name: string; readonly state: "failed"; readonly failure: FailureData }
  | {
      readonly name: string
      readonly state: "ready"
      readonly product: string
      readonly version: string
      readonly totals?: EngineTotalsData
    }

export interface CountData {
  readonly count: number
  readonly atLeast?: true
}

export interface DefinitionData {
  readonly id: string
  readonly bpmnProcessId: string
  readonly tenantId?: string
  readonly version: number
  readonly name?: string
}

export interface CounterReadingData {
  readonly engine: string
  readonly count?: CountData
  readonly above?: true
  readonly undecided?: true
}

export interface CounterData {
  readonly kind: "counter"
  readonly widget: CounterWidget
  readonly readings: readonly CounterReadingData[]
  readonly known: number
  readonly total?: CountData
}

export type InstanceStateData = "running" | "suspended" | "completed" | "terminated"

export interface InstanceData {
  readonly id: string
  readonly definition: DefinitionData
  readonly state: InstanceStateData
  readonly hasIncident: boolean
  readonly businessKey?: string
  readonly startedAt?: string
  readonly endedAt?: string
}

export interface InstanceGroupData {
  readonly engine: string
  readonly instances?: readonly InstanceData[]
  readonly total?: CountData
}

export interface InstanceListData {
  readonly kind: "instanceList"
  readonly widget: InstanceListWidget
  readonly groups: readonly InstanceGroupData[]
}

export interface IncidentSummaryRowData {
  readonly engine: string
  readonly process?: DefinitionData
  readonly withIncident?: number
}

export interface IncidentSummaryData {
  readonly kind: "incidentSummary"
  readonly widget: IncidentSummaryWidget
  readonly engines: number
  readonly known: number
  readonly total?: number
  readonly rows: readonly IncidentSummaryRowData[]
}

export interface BadgeData {
  readonly elementId: string
  readonly active: number
  readonly incidents: number
  readonly incidentsInCalledInstances: number
}

export interface ProcessDiagramData {
  readonly kind: "processDiagram"
  readonly widget: ProcessDiagramWidget
  readonly engine: string
  readonly latest?: DefinitionData
  readonly notDeployed?: true
  readonly badges?: readonly BadgeData[]
}

export interface IncidentData {
  readonly id: string
  readonly instanceId: string
  readonly definition: DefinitionData
  readonly elementId: string
  readonly type: string
  readonly message: string
  readonly createdAt: string
}

export interface IncidentGroupData {
  readonly engine: string
  readonly incidents?: readonly IncidentData[]
  readonly more?: true
}

export interface IncidentListData {
  readonly kind: "incidentList"
  readonly widget: IncidentListWidget
  readonly groups: readonly IncidentGroupData[]
}

export interface RefusedData {
  readonly kind: "refused"
  readonly widget?: string
  readonly title?: string
  readonly problems: readonly ProblemData[]
}

export type TileData =
  | CounterData
  | InstanceListData
  | IncidentSummaryData
  | ProcessDiagramData
  | IncidentListData
  | RefusedData

export interface BoardData {
  readonly title: string
  readonly engines: readonly EngineData[]
  readonly rows: readonly (readonly TileData[])[]
  readonly notes: readonly ProblemData[]
}
