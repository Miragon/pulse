import { useState } from "react"

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

/** The sizing state a `DataTable` takes (`sizing`). */
export interface ColumnSizing {
  /** The sized widths, or `undefined` while every column fits its content. */
  widths: ColumnWidths | undefined
  /** The narrowest a column may get. */
  min: number
  /** Sets the widths; `persist` hands them to `save` (a drag saves once, when it ends). */
  setWidths: (next: ColumnWidths | undefined, persist: boolean) => void
  /** Hands the widths as they are to `save` (the end of a drag). */
  persist: () => void
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

/**
 * The column sizing of a `DataTable`, by mouse and keyboard: a grip on each head's edge and a
 * column menu. Without sizing a column fits its content; once one is sized the table lays out
 * fixed, every sized column at its width and the last one taking the rest. Persistence is
 * injected (`load`, `save`), so the kit keeps nothing itself: an MCP view passes none and its
 * widths last as long as the view, an editor keeps them in its own state.
 */
export function useColumnSizing({ load, save, min = COLUMN_WIDTH.min }: ColumnSizingOptions = {}) {
  const [widths, setState] = useState<ColumnWidths | undefined>(() => validWidths(load?.(), min))
  const sizing: ColumnSizing = {
    widths,
    min,
    setWidths: (next, persist) => {
      setState(next)
      if (persist) save?.(next)
    },
    persist: () => save?.(widths),
  }
  return sizing
}
