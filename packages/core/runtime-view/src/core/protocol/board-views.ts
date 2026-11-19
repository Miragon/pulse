import type {
  CounterData,
  IncidentListData,
  IncidentSummaryData,
  InstanceListData,
  ProblemData,
  ProcessDiagramData,
  RefusedData,
} from "./board-data.js"
import type { EngineBadge, InstanceListFilter, Problem } from "./view-models.js"

type BoardEngineState = "ready" | "failed" | "notConfigured"

export interface BoardEngineStatus {
  readonly name: string
  readonly state: BoardEngineState
  readonly badge?: EngineBadge
  readonly product?: string
  readonly running?: number
  readonly withIncident?: number
  readonly problem?: Problem
}

export interface UnreadableFile {
  readonly path: "(file)"
  readonly code: "unreadable"
}

export type BoardFileProblem = ProblemData | UnreadableFile

export interface BoardTarget {
  readonly engine: string
  readonly bpmnProcessId?: string
  readonly filter: InstanceListFilter
}

export interface CounterTile extends CounterData {
  readonly targets: readonly BoardTarget[]
}

export type InstanceListTile = InstanceListData

export interface IncidentSummaryTile extends IncidentSummaryData {
  readonly targets: readonly BoardTarget[]
}

export interface ProcessDiagramTile extends ProcessDiagramData {
  readonly diagramXml?: string
}

export type IncidentListTile = IncidentListData

export type RefusedTile = RefusedData

export type BoardTile =
  | CounterTile
  | InstanceListTile
  | IncidentSummaryTile
  | ProcessDiagramTile
  | IncidentListTile
  | RefusedTile

export interface BoardView {
  readonly kind: "board"
  readonly asOf: string
  readonly title: string
  readonly fileName: string
  readonly engines: readonly BoardEngineStatus[]
  readonly rows: readonly (readonly BoardTile[])[]
  readonly problems: readonly BoardFileProblem[]
  readonly notes: readonly ProblemData[]
}
