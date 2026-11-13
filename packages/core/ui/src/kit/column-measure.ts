import { clampWidth, widthsOf, type ColumnSizing, type ColumnWidths } from "./column-sizing.js"

/** The cell's side padding (2 × 12 px) around a head's caption and menu button. */
const HEAD_PADDING = 24

/** What a head cell measures by: its key and its content, the caption and the menu button. */
export const COLUMN_KEY_ATTRIBUTE = "data-column-key"
const COLUMN_HEAD_SLOT = '[data-slot="column-head"]'

export function cellWidth(cell: Element): number {
  return Math.round(cell.getBoundingClientRect().width)
}

/** The narrowest a head may get: its caption and menu button stay whole. */
function headFloor(cell: Element): number {
  return (cell.querySelector(COLUMN_HEAD_SLOT)?.scrollWidth ?? 0) + HEAD_PADDING
}

/** The widths the sized columns have now, read off the head row: the start of a sizing. */
function headWidths(cell: Element, keys: readonly string[]): ColumnWidths {
  const heads = [...(cell.parentElement?.children ?? [])]
  return Object.fromEntries(
    keys.map((key) => {
      const head = heads.find((candidate) => candidate.getAttribute(COLUMN_KEY_ATTRIBUTE) === key)
      return [key, cellWidth(head ?? cell)]
    }),
  )
}

/**
 * The width the column's content asks for, measured with the table laid out by its content for a
 * moment, at most half of what the table's region shows (one long value never takes the view).
 */
function naturalWidth(cell: Element): number {
  const table = cell.closest("table")
  if (!table) return cellWidth(cell)
  const visible = table.parentElement?.clientWidth ?? 0
  const kept = table.getAttribute("style")
  const cols = [...table.querySelectorAll("col")].map((col) => [col, col.style.width] as const)
  table.style.tableLayout = "auto"
  table.style.width = "max-content"
  table.style.minWidth = "0"
  for (const [col] of cols) col.style.width = ""
  const natural = cellWidth(cell)
  if (kept === null) table.removeAttribute("style")
  else table.setAttribute("style", kept)
  for (const [col, width] of cols) col.style.width = width
  return visible > 0 ? Math.min(natural, visible / 2) : natural
}

/** Sizing operations on a head cell, over the table's `ColumnSizing`. */
export interface ColumnSizer {
  min: number
  /** The widths of the columns that size, when each has one (`widthsOf`); else none. */
  widths: ColumnWidths | undefined
  widthOf: (key: string) => number | undefined
  /** Sets one column's width; the first sizing takes every sized column's width as it shows. */
  resize: (cell: Element, key: string, width: number, persist: boolean) => void
  /** The column takes its content's width. */
  fit: (cell: Element, key: string) => void
  /** Every column fits its content again. */
  reset: () => void
  /** Saves the widths as they are (the end of a drag). */
  persist: () => void
}

/** `keys`: the columns that size (neither the last nor one of a fixed width). */
export function columnSizer(sizing: ColumnSizing, keys: readonly string[]): ColumnSizer {
  const widths = widthsOf(sizing.widths, keys)
  const resize = (cell: Element, key: string, width: number, persist: boolean) => {
    const base = widths ?? headWidths(cell, keys)
    const next = { ...base, [key]: clampWidth(width, headFloor(cell), sizing.min) }
    sizing.setWidths(next, persist)
  }
  return {
    min: sizing.min,
    widths,
    widthOf: (key) => widths?.[key],
    resize,
    fit: (cell, key) => resize(cell, key, naturalWidth(cell), true),
    reset: () => sizing.setWidths(undefined, true),
    persist: sizing.persist,
  }
}
