import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import { useLocale, useUiMessages } from "../locale/locale-provider.js"
import { formatCountIn } from "../locale/ui-messages.js"
import { cn } from "../lib/utils.js"
import { COLUMN_WIDTH } from "./column-sizing.js"
import { cellWidth, type ColumnSizer } from "./column-measure.js"

/** Under forced colours: a focused grip's outline, `--focus-width` of `Highlight` inside its target. */
const GRIP_FORCED_FOCUS =
  "forced-colors:focus-visible:outline-(length:--focus-width) forced-colors:focus-visible:outline-solid forced-colors:focus-visible:outline-[Highlight] forced-colors:focus-visible:-outline-offset-(--focus-width)"

/** A key press sizes by 8 px, with Shift by 32 px. */
const GRIP_STEP = 8
const GRIP_SHIFT_STEP = 32

/**
 * The width its head shows, measured once it is drawn and again whenever the head changes size,
 * so the separator says its value before it ever had focus (WCAG 4.1.2: a focusable separator
 * carries `aria-valuenow`).
 */
function useHeadWidth() {
  const [width, setWidth] = useState<number>()
  // A callback ref: it measures the head the grip sits in once attached and stops on detach.
  const attach = useCallback((grip: HTMLDivElement | null) => {
    const cell = grip?.parentElement
    if (!cell) return
    const measure = () => setWidth(cellWidth(cell))
    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(cell)
    return () => observer.disconnect()
  }, [])
  return [width, attach, setWidth] as const
}

/**
 * The grip on a head's right edge: a 24 px target centred on the edge, a 2 px `--interaction`
 * line on hover, focus and while dragging (its focus indicator, `--focus-width` wide). Under
 * forced colours a focused grip also draws a real outline around its target in `Highlight`, since
 * a contrast theme may drop a background, the line's only paint; at rest it draws none. A
 * focusable separator with the column's width as its value from the start: ArrowLeft and
 * ArrowRight size it (Shift for bigger steps), Enter and a double click fit it to its content, Home
 * makes it as narrow as its caption allows, Escape cancels a drag.
 */
export function ColumnGrip({
  column,
  columnKey,
  sizer,
}: {
  /** The column's name in words. */
  column: string
  columnKey: string
  sizer: ColumnSizer
}) {
  const { dataTable } = useUiMessages()
  const locale = useLocale()
  const drag = useRef<{ x: number; width: number; cell: Element } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [measured, attachGrip, setMeasured] = useHeadWidth()
  const width = sizer.widthOf(columnKey) ?? measured
  const cellOf = (event: { currentTarget: Element }) => event.currentTarget.parentElement!
  const end = (persist: boolean) => {
    drag.current = null
    setDragging(false)
    if (persist) sizer.persist()
  }
  const keys: Record<string, (cell: Element, shift: boolean) => void> = {
    ArrowLeft: (cell, shift) =>
      sizer.resize(cell, columnKey, cellWidth(cell) - (shift ? GRIP_SHIFT_STEP : GRIP_STEP), true),
    ArrowRight: (cell, shift) =>
      sizer.resize(cell, columnKey, cellWidth(cell) + (shift ? GRIP_SHIFT_STEP : GRIP_STEP), true),
    Enter: (cell) => sizer.fit(cell, columnKey),
    Home: (cell) => sizer.resize(cell, columnKey, 0, true),
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const started = drag.current
    if (event.key === "Escape" && started) {
      event.stopPropagation()
      sizer.resize(started.cell, columnKey, started.width, true)
      end(false)
      return
    }
    const action = keys[event.key]
    if (!action) return
    event.preventDefault()
    action(cellOf(event), event.shiftKey)
  }
  return (
    <div
      ref={attachGrip}
      role="separator"
      aria-orientation="vertical"
      aria-label={dataTable.resizeColumn({ column })}
      aria-valuemin={sizer.min}
      aria-valuemax={COLUMN_WIDTH.max}
      aria-valuenow={width}
      aria-valuetext={
        width === undefined
          ? undefined
          : dataTable.columnWidth({ width: formatCountIn(width, locale) })
      }
      tabIndex={0}
      data-slot="column-grip"
      data-dragging={dragging || undefined}
      className={cn(
        "absolute inset-y-0 -right-3 z-[1] w-6 cursor-col-resize touch-none outline-none",
        "after:bg-interaction after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:opacity-0 after:transition-opacity motion-reduce:after:transition-none",
        "hover:after:opacity-100 focus-visible:after:w-(--focus-width) focus-visible:after:opacity-100 data-dragging:after:opacity-100",
        "forced-colors:after:bg-[Highlight] forced-colors:after:forced-color-adjust-none",
        GRIP_FORCED_FOCUS,
      )}
      onKeyDown={onKeyDown}
      onFocus={(event) => setMeasured(cellWidth(cellOf(event)))}
      onDoubleClick={(event) => sizer.fit(cellOf(event), columnKey)}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return
        const cell = cellOf(event)
        event.currentTarget.setPointerCapture?.(event.pointerId)
        drag.current = { x: event.clientX, width: cellWidth(cell), cell }
        setDragging(true)
        sizer.resize(cell, columnKey, drag.current.width, false)
      }}
      onPointerMove={(event) => {
        const started = drag.current
        if (!started) return
        sizer.resize(started.cell, columnKey, started.width + event.clientX - started.x, false)
      }}
      onPointerUp={() => {
        if (drag.current) end(true)
      }}
      onLostPointerCapture={() => {
        if (drag.current) end(true)
      }}
    />
  )
}
