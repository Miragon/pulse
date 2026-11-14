import { useRef, useState } from "react"
import { cn } from "../lib/utils.js"
import { ColumnGrip } from "./column-grip.js"
import { columnSizer } from "./column-measure.js"
import { ColumnMenu } from "./column-menu.js"
import {
  COLUMN_WIDTH,
  validWidths,
  type ColumnSizing,
  type ColumnSizingOptions,
  type ColumnWidths,
  type SizedHeadProps,
} from "./column-sizing.js"

/** A sized head's content: its caption with the column menu after it, the grip on its edge. */
function SizedHead({ caption, align, column, columnKey, sizer }: SizedHeadProps) {
  return (
    <>
      <span
        data-slot="column-head"
        className={cn(
          "inline-flex max-w-full items-center gap-1 align-middle",
          align === "right" && "flex-row-reverse",
        )}
      >
        <span className="min-w-0 truncate">{caption}</span>
        <ColumnMenu column={column} columnKey={columnKey} sizer={sizer} />
      </span>
      <ColumnGrip column={column} columnKey={columnKey} sizer={sizer} />
    </>
  )
}

/**
 * The column sizing of a `DataTable`, by mouse and keyboard: a grip on each head's edge and a
 * column menu. Without sizing a column fits its content; once one is sized the table lays out
 * fixed, every sized column at its width and the last one taking the rest. Persistence is
 * injected (`load`, `save`), so the kit keeps nothing itself: an MCP view passes none and its
 * widths last as long as the view, an editor keeps them in its own state. The grip, the menu and
 * their measuring come with the object it returns, so a table without `sizing` never loads them.
 * `persist` saves the widths last set, even when that change has not rendered yet (a drag that
 * ends right after its last move).
 */
export function useColumnSizing({ load, save, min = COLUMN_WIDTH.min }: ColumnSizingOptions = {}) {
  const [widths, setState] = useState<ColumnWidths | undefined>(() => validWidths(load?.(), min))
  const latest = useRef(widths)
  const sizing: ColumnSizing = {
    widths,
    min,
    setWidths: (next, persist) => {
      latest.current = next
      setState(next)
      if (persist) save?.(next)
    },
    persist: () => save?.(latest.current),
    parts: { sizer: (keys) => columnSizer(sizing, keys), Head: SizedHead },
  }
  return sizing
}
