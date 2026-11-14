import type { ComponentType, ReactNode, Ref } from "react"
import type { ColumnSizing } from "./column-sizing.js"
import type { ColumnSort } from "./table.js"

/** One column of a `DataTable`: its head and, for the `rows` of the table, its cell. */
export interface DataTableColumn<Row = unknown> {
  /** Stable and unique in the table: the column's sizing key. */
  key: string
  /** The head's caption. */
  label?: ReactNode
  /** The column's name in words, for its sizing grip and menu (by default the caption's text). */
  name?: string
  align?: "left" | "right"
  /**
   * A bare head, the rule and the padding only: no caption treatment, never sized. For a head that
   * holds a control (the box that selects every row) instead of a caption; the row actions' column
   * has its caption ("Actions") like any other.
   */
  plain?: boolean
  sort?: ColumnSort
  /** Classes of the head cell. */
  className?: string
  /** A fixed width in CSS px: the column never sizes (a box, an icon). */
  width?: number
  /**
   * With `rows`, while the columns fit their content: this column takes the room the others
   * leave instead of the last one, so the identifying column (a `NamedId`) shows whole where there
   * is room and cuts its line first where there is not. One column at most.
   */
  fill?: boolean
  /**
   * With hand-composed `children`, while the columns are not sized: this column fits its content
   * as a drawn row's does, its cells one line and a `NamedId` in them whole, so the columns without
   * it share the room it leaves. The table marks the column's cells by their position, so a
   * composed row's cells take no class for it. A position counts the column spans of the cells
   * before it in its row, not the row spans of the rows above, so a cell that spans rows shifts the
   * cells below it. Drawn `rows` fit every column but the one that takes the rest by themselves.
   */
  fit?: boolean
  /** The cell of one of the table's `rows`. */
  cell?: (row: Row) => ReactNode
  /** Classes of each of its body cells (with `rows`). */
  cellClassName?: string
}

/** What the selection column's box takes: its name, its state and a toggle. */
export interface SelectionBoxProps {
  "aria-label": string
  checked: boolean | "indeterminate"
  onCheckedChange: () => void
  tabIndex?: number
  className?: string
}

/**
 * The selection column of a `DataTable`, as `rowSelection` builds it: a checkbox per row, one in
 * the head for every row shown.
 */
export interface DataTableSelection<Row> {
  isSelected: (row: Row) => boolean
  /** Whether the row can be chosen at all; a row that cannot shows no box. Default: every row. */
  isSelectable?: (row: Row) => boolean
  onToggle: (row: Row) => void
  /** The head's box: every row shown chosen, some (`"indeterminate"`, read as mixed) or none. */
  all: boolean | "indeterminate"
  onToggleAll: () => void
  /** The accessible name of a row's box ("Select order-1001"). */
  rowLabel: (row: Row) => string
  /** The accessible name of the head's box; the kit's "Select all shown rows" by default. */
  allLabel?: string
  /**
   * The box of each row and of the head, the kit's `Checkbox`, brought along by `rowSelection`, so
   * a table without a selection column never loads it.
   */
  Box: ComponentType<SelectionBoxProps>
}

/** How a row opened: in place, or beside the view (Ctrl or Cmd held). */
export interface RowActivation {
  toSide: boolean
}

export interface DataTableProps<Row = unknown> {
  /** Names the table and its scroll region. */
  label: string
  columns: ReadonlyArray<DataTableColumn<Row>>
  /**
   * The rows, each drawn by the columns' `cell`s, one line each: every column fits its content
   * and one takes the rest (the `fill` column, else the last). Without them the table's body is
   * its `children`, rows composed by hand (`<tr>` with `Td`s), one cell per column, laid out by
   * their content, a column marked `fit` as narrow as its one line.
   */
  rows?: ReadonlyArray<Row>
  /** A row's stable key (with `rows`). */
  rowKey?: (row: Row) => string
  /**
   * Makes each row a target (with `rows`): a click or Enter opens it, Ctrl or Cmd with them
   * beside the view. The rows then take one tab stop, and the arrows, Home and End move between
   * them.
   */
  onActivate?: (row: Row, how: RowActivation) => void
  /** Ctrl or Cmd with C on a focused row copies what it names (with `rows`). */
  onCopy?: (row: Row) => void
  /**
   * A selection column before the first one (with `rows`, from `rowSelection`); Space on a focused
   * row toggles it.
   */
  selection?: DataTableSelection<Row>
  /** While loading: this many placeholder rows (8 px bars) instead of the head and body. */
  skeletonRows?: number
  /** Shown under the head when `rows` is empty. */
  empty?: ReactNode
  /** Under the table, inside its scroll region (a "Load more"). */
  footer?: ReactNode
  /** The column sizing (`useColumnSizing`); without it every column fits its content. */
  sizing?: ColumnSizing
  /** Hand-composed body rows, when the table has no `rows`. */
  children?: ReactNode
  /**
   * Lets a long caption wrap where the region is short of room, so a wide table of figures keeps
   * every column in view. By default each head keeps one line, and a table short of room cuts a
   * `NamedId`'s line first, then scrolls inside its region.
   */
  wrapHeads?: boolean
  /** Rows above the column heads, inside the sticky head (heads over groups of columns). */
  headRows?: ReactNode
  /** A `<tfoot>`'s rows after the body. */
  foot?: ReactNode
  /** The body element, for a measure of its rows. */
  bodyRef?: Ref<HTMLTableSectionElement>
  /** Classes of the frame around the scroll region (its size in a layout). */
  className?: string
  /** Classes of the `<table>`. */
  tableClassName?: string
}
