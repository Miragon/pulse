import type { BoardColumn } from "../protocol/index.js"

export type BoardState = "running" | "ended"

export type IncidentGrouping = "engine" | "process"

export interface BoardFilter {
  readonly process?: string
  readonly activeElement?: string
  readonly state: BoardState
  readonly withIncident?: boolean
  readonly businessKey?: string
}

interface WidgetBase {
  readonly title?: string
  readonly engines: readonly string[]
}

export interface CounterWidget extends WidgetBase {
  readonly widget: "counter"
  readonly filter: BoardFilter
  readonly warnAbove?: number
}

export interface InstanceListWidget extends WidgetBase {
  readonly widget: "instanceList"
  readonly filter: BoardFilter
  readonly columns: readonly BoardColumn[]
}

export interface IncidentSummaryWidget extends WidgetBase {
  readonly widget: "incidentSummary"
  readonly groupBy: IncidentGrouping
}

export interface ProcessDiagramWidget extends WidgetBase {
  readonly widget: "processDiagram"
  readonly process: string
}

export interface IncidentListWidget extends WidgetBase {
  readonly widget: "incidentList"
  readonly process?: string
}

export type BoardWidget =
  | CounterWidget
  | InstanceListWidget
  | IncidentSummaryWidget
  | ProcessDiagramWidget
  | IncidentListWidget

export type BoardWidgetType = BoardWidget["widget"]

export interface BoardDefinition {
  readonly title: string
  readonly engines: readonly string[]
  readonly rows: readonly (readonly BoardWidget[])[]
}
