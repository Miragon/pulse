import type { ComponentType, ReactNode } from "react"
import type { ColumnSizer } from "./column-measure.js"

/** The widths of a table's sized columns in CSS px, by column key. */
export type ColumnWidths = Readonly<Record<string, number>>

/** The narrowest and the widest a column may be sized to, in CSS px. */
export const COLUMN_WIDTH = { min: 48, max: 2000 } as const

/** The room a sized table keeps for its last column, which takes what the others leave. */
const LAST_COLUMN_MIN = 80

export interface ColumnSizingOptions {
  /**
   * The widths kept from an earlier visit, read once when the table mounts; a width outside
   * `min` and 2,000 px is dropped. Without it every column fits its content.
   */
  load?: () => ColumnWidths | undefined
  /**
   * Called with the widths once a sizing ends (a drag let go, a key, a menu entry), and with
   * `undefined` when they are reset. Where they are kept is the host's: an editor's state, never
   * the kit's.
   */
  save?: (widths: ColumnWidths | undefined) => void
  /** The narrowest a column may get, in CSS px (48 by default). */
  min?: number
}

/** The sizing a `DataTable` takes (`sizing`), as `useColumnSizing` returns it. */
export interface ColumnSizing {
  /** The sized widths, or `undefined` while every column fits its content. */
  widths: ColumnWidths | undefined
  /** The narrowest a column may get. */
  min: number
  /** Sets the widths; `persist` hands them to `save` (a drag saves once, when it ends). */
  setWidths: (next: ColumnWidths | undefined, persist: boolean) => void
  /** Hands the widths as they are to `save` (the end of a drag). */
  persist: () => void
  /**
   * What a sized table draws in its heads, brought along by `useColumnSizing`, so a table that
   * never sizes loads none of it.
   */
  parts: ColumnSizingParts
}

/** What a sized head shows: its caption, and the column it sizes. */
export interface SizedHeadProps {
  caption: ReactNode
  align: "left" | "right"
  /** The column's name in words, for the grip and the menu. */
  column: string
  columnKey: string
  sizer: ColumnSizer
}

/** The parts of a sized table: its sizer, its heads' grip and column menu, and their measuring. */
export interface ColumnSizingParts {
  /** The sizing operations over the columns that size (`keys`). */
  sizer: (keys: readonly string[]) => ColumnSizer
  /** A sized head's content: the caption with its column menu, the grip on the head's edge. */
  Head: ComponentType<SizedHeadProps>
}

function isWidth(value: unknown, min: number): value is number {
  return typeof value === "number" && value >= min && value <= COLUMN_WIDTH.max
}

/** The kept widths that are widths at all; none at all reads as no sizing. */
export function validWidths(
  widths: ColumnWidths | undefined,
  min: number = COLUMN_WIDTH.min,
): ColumnWidths | undefined {
  if (widths === undefined || widths === null || typeof widths !== "object") return undefined
  const valid = Object.entries(widths).filter(([, width]) => isWidth(width, min))
  return valid.length === 0 ? undefined : Object.fromEntries(valid)
}

/**
 * The widths of the columns that size now (`keys`), when each of them has one: a kept width of a
 * column the table no longer shows drops out, and a column without one (new since the widths
 * were kept) makes every column fit its content again, until the next sizing takes them all.
 */
export function widthsOf(
  widths: ColumnWidths | undefined,
  keys: readonly string[],
): ColumnWidths | undefined {
  if (widths === undefined || keys.length === 0) return undefined
  const picked = keys.map((key) => [key, widths[key]] as const)
  return picked.every(([, width]) => width !== undefined) ? Object.fromEntries(picked) : undefined
}

/** A width inside the bounds, at least `floor` (a head's caption needs its room), whole px. */
export function clampWidth(width: number, floor: number, min: number = COLUMN_WIDTH.min): number {
  return Math.round(Math.min(COLUMN_WIDTH.max, Math.max(min, floor, width)))
}

/** A sized table's minimum width: its sized and fixed columns and the room of the last one. */
export function tableMinWidth(widths: ColumnWidths, fixed: number): number {
  return Object.values(widths).reduce((sum, width) => sum + width, LAST_COLUMN_MIN + fixed)
}
