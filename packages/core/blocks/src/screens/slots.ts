import type { ScreenTarget } from "@miragon/pulse-screens"
import type { ComponentType, ReactNode } from "react"

/** How a target opens: in place, or beside the view (Ctrl or Cmd held) where the surface can. */
export interface ScreenOpenHow {
  readonly toSide: boolean
}

/** The narrowest region in which a column stays: under it the surface's table drops it. */
export type ScreenColumnWidth = "40rem"

/** A column of a screen's table: its caption, the cell of a row and where it drops. */
export interface ScreenTableColumn<Row> {
  readonly key: string
  readonly label: string
  readonly cell: (row: Row) => ReactNode
  /**
   * The column drops while the table's region is narrower: a table that fits its region does
   * (the web app's), one whose columns the user sizes keeps it (the editors').
   */
  readonly hideBelow?: ScreenColumnWidth
}

/** What a row's copy puts on the clipboard, and what it names ("BPMN process ID"). */
export interface ScreenCopy {
  readonly text: string
  readonly label: string
}

/** The props of the surface's table: the block owns the columns, the cells and the words. */
export interface ScreenTableProps<Row> {
  /**
   * The table's name on its screen ("processes"), stable across languages: what a surface keys
   * the table's memory by (the editors' column widths).
   */
  readonly name: string
  /** Names the table and its scroll region. */
  readonly label: string
  readonly columns: readonly ScreenTableColumn<Row>[]
  readonly rows: readonly Row[]
  readonly rowKey: (row: Row) => string
  /** Opens a row: a click on it or Enter, Ctrl or Cmd held beside the view. */
  readonly onOpen: (row: Row, how: ScreenOpenHow) => void
  /**
   * The address of what a row opens, where the surface has addresses (`ScreenSlots.linkOf`): the
   * row is a link to it, so Ctrl or Cmd with a click and a middle click open it in a new tab.
   */
  readonly linkOf?: (row: Row) => string
  /** The accessible name of a row: what it opens, as the row shows it ("Process Order fulfillment"). */
  readonly rowLabel: (row: Row) => string
  /** What a row's copy puts on the clipboard. */
  readonly copyOf: (row: Row) => ScreenCopy
  /** What the table says without a row: words the surface shows as its empty state. */
  readonly empty: string
}

/**
 * The surface's table, in the one row convention of every surface (a click on a row or Enter opens
 * it, Ctrl or Cmd with C copies it) and its own fit (the web app's region, the editor's sized
 * columns).
 */
export type ScreenTableSlot = <Row>(props: ScreenTableProps<Row>) => ReactNode

/** The props of the surface's id: an id a cell shows, the name it goes by, and what it names. */
export interface ScreenIdProps {
  readonly id: string
  /** The name the engine gives the thing, shown first where there is one. */
  readonly name?: string
  readonly label: string
}

/**
 * What a surface brings to the screens' blocks: its table, its id, where a target opens and, where
 * it has addresses, its link to a target. The blocks keep no React context of their own.
 */
export interface ScreenSlots {
  readonly Table: ScreenTableSlot
  readonly Id: ComponentType<ScreenIdProps>
  readonly onOpen: (target: ScreenTarget, how: ScreenOpenHow) => void
  /**
   * The address of a target on a surface that has addresses (the web app's router): the rows that
   * open the target link to it. Without it (the editors) a target opens through `onOpen` alone.
   */
  readonly linkOf?: (target: ScreenTarget) => string
}
