import type { BadgeData, DefinitionData } from "@miragon/pulse-board"
import type { ComponentType, ReactNode } from "react"

/** How a target opens: in place, or beside the view (Ctrl or Cmd held) where the surface can. */
export interface BoardOpenHow {
  readonly toSide: boolean
}

/** The instances a count, a summary row or a diagram's count names. */
export type BoardScope = "running" | "ended" | "withIncident"

/** The instances a target names, its keys in this order. */
export interface BoardListFilter {
  readonly scope: BoardScope
  readonly elementId?: string
  readonly businessKey?: string
}

/** The instances of a process on an engine, or of the engine when the target names no process. */
export interface BoardInstancesTarget {
  readonly kind: "instances"
  readonly engine: string
  readonly bpmnProcessId?: string
  readonly filter: BoardListFilter
}

/** One instance on an engine; a row of an incident list names the incident too. */
export interface BoardInstanceTarget {
  readonly kind: "instance"
  readonly engine: string
  readonly instanceId: string
  readonly incidentId?: string
}

/** What a tile opens: the surface takes it onto its own navigation (`BoardSlots.onOpen`). */
export type BoardTarget = BoardInstancesTarget | BoardInstanceTarget

/** A column of a tile's table: its caption and the cell of a row. */
export interface BoardTableColumn<Row> {
  readonly key: string
  readonly label: string
  readonly cell: (row: Row) => ReactNode
}

/** What a row's copy puts on the clipboard, and what it names ("Instance ID"). */
export interface BoardCopy {
  readonly text: string
  readonly label: string
}

/** The props of the surface's table: the tile owns the columns, the cells, the words and the notes. */
export interface BoardTableProps<Row> {
  /** Names the table and its scroll region. */
  readonly label: string
  readonly columns: readonly BoardTableColumn<Row>[]
  readonly rows: readonly Row[]
  readonly rowKey: (row: Row) => string
  /** Opens a row: a click on it or on its drill, Ctrl or Cmd held beside the view. */
  readonly onOpen: (row: Row, how: BoardOpenHow) => void
  /** The accessible name of a row's drill ("Open instance 81a2e0b4…"). */
  readonly openLabel: (row: Row) => string
  /** What a row's copy puts on the clipboard. */
  readonly copyOf: (row: Row) => BoardCopy
  /** What the table says without a row. */
  readonly empty: ReactNode
  /** What it says under its rows: each engine's share. */
  readonly footer: ReactNode
}

/** The surface's table, in its own row convention (row activation, a drill, an inline fit). */
export type BoardTableSlot = <Row>(props: BoardTableProps<Row>) => ReactNode

/** The props of the surface's id: an id a cell shows short, and what it names. */
export interface BoardIdProps {
  readonly id: string
  readonly label: string
}

/** The props of the surface's diagram: the version it draws and the counts on its elements. */
export interface BoardDiagramProps {
  readonly engine: string
  /** The latest version of the process on the engine, which the diagram draws. */
  readonly definition: DefinitionData
  readonly badges: readonly BadgeData[]
  /** The canvas's accessible name. */
  readonly label: string
  /** An element chosen on the canvas, with the scope of the count chosen on it, if any. */
  readonly onSelect: (elementId: string, scope: "running" | "withIncident" | undefined) => void
}

/**
 * What a surface brings to the tiles: its table, its id and its diagram, where a target opens and,
 * optionally, how the board file opens. The tiles keep no React context of their own.
 */
export interface BoardSlots {
  readonly Table: BoardTableSlot
  readonly Id: ComponentType<BoardIdProps>
  readonly Diagram: ComponentType<BoardDiagramProps>
  readonly onOpen: (target: BoardTarget, how: BoardOpenHow) => void
  /** Opens the board file; without it a refused tile offers no way to it. */
  readonly onOpenFile?: () => void
  /** True where Ctrl or Cmd with a click opens beside the view: the tiles' titles say so. */
  readonly opensToSide?: boolean
}
