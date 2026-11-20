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

/**
 * The props of the surface's table whose rows open nothing (an instance's history, its waits, its
 * variables): the block owns the columns, the cells and the words.
 */
export interface ScreenPlainTableProps<Row> {
  /**
   * The table's name on its screen ("processes", "history"), stable across languages: what a
   * surface keys the table's memory by (the editors' column widths).
   */
  readonly name: string
  /** Names the table and its scroll region. */
  readonly label: string
  readonly columns: readonly ScreenTableColumn<Row>[]
  readonly rows: readonly Row[]
  readonly rowKey: (row: Row) => string
  /** What the table says without a row: words the surface shows as its empty state. */
  readonly empty: string
}

/** The props of the surface's table whose rows open what they name. */
export interface ScreenTableProps<Row> extends ScreenPlainTableProps<Row> {
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

/**
 * The surface's table whose rows open nothing: the same table, its rows plain (no open, no copy,
 * no tab stop of their own), so the controls in a cell keep the focus.
 */
export type ScreenPlainTableSlot = <Row>(props: ScreenPlainTableProps<Row>) => ReactNode

/**
 * What a link of a block is to the thing it shows, so a surface draws each in its own look: the
 * version an instance runs, the instance that called it, an instance it called.
 */
export type ScreenLinkRel = "version" | "caller" | "called"

/** The props of the surface's link: its target, what it is to the thing shown, and its words. */
export interface ScreenLinkProps {
  readonly rel: ScreenLinkRel
  readonly target: ScreenTarget
  /** What the link opens, in words: its title ("Open called instance 3e9d1c2b-…"). */
  readonly title: string
  /** What the link says. */
  readonly children: ReactNode
}

/**
 * What a surface brings to an instance's blocks: its plain table, its link to a target (the web
 * app's address, the editors' intent) and its copy, which puts a text on the clipboard its own way
 * and says what it copied. A block's write controls (a retry, a variable's editor, a move) are
 * slots of the block that shows them, which only a surface that writes fills.
 */
export interface InstanceSlots {
  readonly PlainTable: ScreenPlainTableSlot
  readonly Link: ComponentType<ScreenLinkProps>
  readonly onCopy: (copy: ScreenCopy) => void
}
