import type { EngineBadge, InstanceListFilter, InstanceStateLabel, Problem } from "./view-models.js"

export type BoardColumn =
  "engine" | "process" | "version" | "businessKey" | "state" | "startedAt" | "endedAt" | "incident"

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

export interface BoardTarget {
  readonly engine: string
  readonly bpmnProcessId?: string
  readonly filter: InstanceListFilter
}

export interface CounterEntry {
  readonly engine: string
  readonly count?: number
  readonly above?: true
  readonly target: BoardTarget
}

export interface CounterTile {
  readonly kind: "counter"
  readonly title: string
  readonly total?: number
  readonly known: number
  readonly warnAbove?: number
  readonly entries: readonly CounterEntry[]
}

export interface BoardInstanceRow {
  readonly engine: string
  readonly id: string
  readonly shortId: string
  readonly processName: string
  readonly bpmnProcessId: string
  readonly version: number
  readonly state: InstanceStateLabel
  readonly hasIncident: boolean
  readonly businessKey?: string
  readonly startedAt?: string
  readonly endedAt?: string
}

export interface InstanceGroup {
  readonly engine: string
  readonly rows: readonly BoardInstanceRow[]
  readonly total?: number
  readonly unavailable?: true
}

export interface InstanceListTile {
  readonly kind: "instanceList"
  readonly title: string
  readonly columns: readonly BoardColumn[]
  readonly groups: readonly InstanceGroup[]
}

export interface IncidentSummaryRow {
  readonly engine: string
  readonly label: string
  readonly withIncident?: number
  readonly target: BoardTarget
}

export interface IncidentSummaryTile {
  readonly kind: "incidentSummary"
  readonly title: string
  readonly groupBy: "engine" | "process"
  readonly total?: number
  readonly known: number
  readonly engines: number
  readonly rows: readonly IncidentSummaryRow[]
}

export type BoardTile = CounterTile | InstanceListTile | IncidentSummaryTile

export interface BoardProblem {
  readonly path: string
  readonly reason: string
}

export interface BoardView {
  readonly kind: "board"
  readonly asOf: string
  readonly title: string
  readonly fileName: string
  readonly engines: readonly BoardEngineStatus[]
  readonly rows: readonly (readonly BoardTile[])[]
  readonly problems: readonly BoardProblem[]
}
