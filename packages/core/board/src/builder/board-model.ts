import type {
  DefinitionRef,
  ElementStatistics,
  EngineInfo,
  Incident,
  InstanceCount,
  InstanceSummary,
} from "@miragon/pulse-engine-core"
import type {
  CounterWidget,
  IncidentListWidget,
  IncidentSummaryWidget,
  InstanceListWidget,
  ProcessDiagramWidget,
} from "../format/board-definition.js"

export interface EngineTotals {
  readonly running: number
  readonly withIncident: number
}

export type EngineModel =
  | { readonly name: string; readonly state: "notConfigured" }
  | { readonly name: string; readonly state: "failed"; readonly error: unknown }
  | {
      readonly name: string
      readonly state: "ready"
      readonly info: EngineInfo
      readonly totals?: EngineTotals
    }

export interface CounterReading {
  readonly engine: string
  readonly count?: InstanceCount
  readonly above?: true
  readonly undecided?: true
}

export interface CounterModel {
  readonly kind: "counter"
  readonly widget: CounterWidget
  readonly readings: readonly CounterReading[]
  readonly known: number
  readonly total?: InstanceCount
}

export interface InstanceGroupModel {
  readonly engine: string
  readonly instances?: readonly InstanceSummary[]
  readonly total?: InstanceCount
}

export interface InstanceListModel {
  readonly kind: "instanceList"
  readonly widget: InstanceListWidget
  readonly groups: readonly InstanceGroupModel[]
}

export interface IncidentSummaryRowModel {
  readonly engine: string
  readonly process?: DefinitionRef
  readonly withIncident?: number
}

export interface IncidentSummaryModel {
  readonly kind: "incidentSummary"
  readonly widget: IncidentSummaryWidget
  readonly engines: number
  readonly known: number
  readonly total?: number
  readonly rows: readonly IncidentSummaryRowModel[]
}

export interface ProcessDiagramModel {
  readonly kind: "processDiagram"
  readonly widget: ProcessDiagramWidget
  readonly engine: string
  readonly latest?: DefinitionRef
  readonly notDeployed?: true
  readonly badges?: readonly ElementStatistics[]
}

export interface IncidentGroupModel {
  readonly engine: string
  readonly incidents?: readonly Incident[]
  readonly more?: true
}

export interface IncidentListModel {
  readonly kind: "incidentList"
  readonly widget: IncidentListWidget
  readonly groups: readonly IncidentGroupModel[]
}

export type TileModel =
  CounterModel | InstanceListModel | IncidentSummaryModel | ProcessDiagramModel | IncidentListModel

export interface BoardModel {
  readonly title: string
  readonly engines: readonly EngineModel[]
  readonly rows: readonly (readonly TileModel[])[]
}
