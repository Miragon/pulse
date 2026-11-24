// Replaced by @miragon/pulse-ui's MeterRows once Miragon/pulse#663 lands.
import type { ReactNode } from "react"

export interface MeterRow {
  key: string
  label: ReactNode
  /** The row's figure in words, formatted (a count and its share). */
  value: string
  /** The row's share of the whole, 0 to 1: the bar's length. */
  share: number
}

export interface MeterRowsProps {
  /** Names the list. */
  label: string
  rows: readonly MeterRow[]
}

/**
 * Shares of a whole, one row each: the label and the figure on a line, a bar under them on the
 * info ramp over a quiet track. The figure says what the bar shows, so the bar is decoration.
 */
export function MeterRows({ label, rows }: MeterRowsProps) {
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col gap-3 p-0">
      {rows.map((row) => (
        <li key={row.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate">{row.label}</span>
            <span className="flex-none tabular-nums">{row.value}</span>
          </div>
          <div aria-hidden="true" className="bg-muted h-2 overflow-hidden rounded-full">
            <div
              className="bg-chart-1 h-full rounded-full"
              style={{ width: `${String(Math.max(0, Math.min(1, row.share)) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
