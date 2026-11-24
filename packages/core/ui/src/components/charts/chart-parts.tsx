import { useCallback, useState, type KeyboardEvent, type PointerEvent } from "react"
import { createPortal } from "react-dom"
import { FOCUS_RING } from "../../lib/focus-ring.js"
import { cn } from "../../lib/utils.js"
import { useUiLocale, useUiMessages } from "../../locale/locale-provider.js"
import { usePortalContainer } from "../../theme/portal-container.js"
import {
  BAR_FILL,
  LINE_DASH,
  LINE_STROKE,
  LINE_WIDTH,
  PLOT,
  type SeriesSlot,
  type SlottedSeries,
} from "./chart-series.js"
import type { ChartPoint, ChartUnit } from "./chart-types.js"
import type { PlacedLabel } from "./chart-layout.js"
import { valueText } from "./chart-values.js"

/** Room above the plot for the top tick's label, which sits centred on its grid line. */
export const PLOT_TOP = 10
/** The band under the plot for the point labels (13 px on its line and the gap above it). */
export const POINT_AXIS = 24

/**
 * The width its element lays out at, floored to whole pixels so the drawing never runs a
 * fraction past it; `null` until measured (a server render, a collapsed element). It measures
 * once attached and again whenever the element changes size, as the kit's other measured parts
 * do (a callback ref, a ResizeObserver).
 */
export function useChartWidth() {
  const [width, setWidth] = useState<number | null>(null)
  const attach = useCallback((node: HTMLElement | null) => {
    if (!node) return
    const measure = () => {
      const measured = Math.floor(node.getBoundingClientRect().width)
      setWidth(measured > 0 ? measured : null)
    }
    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [attach, width] as const
}

const KEY_STEP: Readonly<Record<string, (from: number, last: number) => number>> = {
  ArrowLeft: (from) => from - 1,
  ArrowRight: (from) => from + 1,
  Home: () => 0,
  End: (_, last) => last,
}

/**
 * The point the tooltip shows: the one under the pointer (moved over or pressed, so a tap shows
 * one and a swipe still scrolls the page), or, with the plot focused, the one the arrow keys, Home
 * and End move to (the latest when focus arrives). Escape and leaving close it; a touch keeps it
 * until the next one.
 */
export function useActivePoint(count: number, indexAt: (x: number) => number) {
  const [active, setActive] = useState<number | null>(null)
  const index = active !== null && active < count ? active : null
  const last = count - 1
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const step = KEY_STEP[event.key]
    if (step && count > 0) {
      event.preventDefault()
      setActive(Math.min(last, Math.max(0, step(index ?? last, last))))
    } else if (event.key === "Escape") {
      setActive(null)
    }
  }
  const onFocus = () => {
    if (count > 0) setActive((current) => current ?? last)
  }
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (count === 0) return
    setActive(indexAt(event.clientX - event.currentTarget.getBoundingClientRect().left))
  }
  const onPointerLeave = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch") return
    if (event.currentTarget.ownerDocument.activeElement !== event.currentTarget) setActive(null)
  }
  const onBlur = () => setActive(null)
  return {
    index,
    handlers: {
      onKeyDown,
      onFocus,
      onBlur,
      onPointerDown: onPointerMove,
      onPointerMove,
      onPointerLeave,
    },
  }
}

/** The focus target and pointer surface of a plot: named by the chart, one tab stop. */
export const PLOT_TARGET = cn("block rounded-sm", FOCUS_RING)

/** A series' key in the legend and the tooltip: the mark it draws, small. */
function SeriesKey({ slot, variant }: { slot: SeriesSlot; variant: "bar" | "line" }) {
  if (variant === "bar") {
    return (
      <svg
        aria-hidden="true"
        width={12}
        height={12}
        viewBox="0 0 12 12"
        className="shrink-0 forced-colors:forced-color-adjust-none"
      >
        <rect x={0.75} y={0.75} width={10.5} height={10.5} rx={2} className={BAR_FILL[slot]} />
      </svg>
    )
  }
  return (
    <svg
      aria-hidden="true"
      width={16}
      height={12}
      viewBox="0 0 16 12"
      className="shrink-0 forced-colors:forced-color-adjust-none"
    >
      <line
        x1={1}
        x2={15}
        y1={6}
        y2={6}
        strokeLinecap="round"
        strokeDasharray={LINE_DASH[slot]}
        className={cn(LINE_STROKE[slot], LINE_WIDTH)}
      />
    </svg>
  )
}

/**
 * The legend of two series or more, above the plot, in its series' order; one series needs none,
 * the chart's heading names it. Hidden from a screen reader, which reads the same names as the
 * table's column heads.
 */
export function ChartLegend({
  series,
  variant,
}: {
  series: readonly SlottedSeries[]
  variant: "bar" | "line"
}) {
  if (series.length < 2) return null
  return (
    <ul
      aria-hidden="true"
      data-slot="chart-legend"
      className="text-small text-muted-foreground m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0"
    >
      {series.map((s) => (
        <li key={s.key} className="inline-flex min-w-0 items-center gap-1.5">
          <SeriesKey slot={s.slot} variant={variant} />
          <span className="min-w-0 break-words">{s.label}</span>
        </li>
      ))}
    </ul>
  )
}

/** The figures of one point: its name, then each series' value before its name. */
function TooltipBody({
  point,
  series,
  unit,
  variant,
}: {
  point: ChartPoint
  series: readonly SlottedSeries[]
  unit: ChartUnit
  variant: "bar" | "line"
}) {
  const words = useUiMessages()
  const locale = useUiLocale()
  return (
    <>
      <p className="m-0 font-semibold break-words">{point.description ?? point.label}</p>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <SeriesKey slot={s.slot} variant={variant} />
            <span className="font-semibold tabular-nums">
              {valueText(point.values[s.key] ?? null, unit, words, locale).shown}
            </span>
            <span className="text-muted-foreground min-w-0 break-words">{s.label}</span>
          </li>
        ))}
      </ul>
    </>
  )
}

/** The tooltip's surface: a popover's, 13 px, never catching the pointer. */
const TOOLTIP =
  "bg-popover text-popover-foreground border-border dark:border-input shadow-2 text-small pointer-events-none absolute z-10 flex w-max flex-col gap-1 rounded-md border px-2 py-1.5"

/**
 * The hovered or focused point's figures over the plot: beside the point, on the side with more
 * room, never wider than that half of the chart, so it never runs past a 360 px view. A sighted
 * reader's view of the table; a screen reader reads the table.
 */
export function ChartTooltip({
  point,
  series,
  unit,
  variant,
  x,
  width,
}: {
  point: ChartPoint
  series: readonly SlottedSeries[]
  unit: ChartUnit
  variant: "bar" | "line"
  x: number
  width: number
}) {
  const onRight = x <= width / 2
  return (
    <div
      aria-hidden="true"
      data-slot="chart-tooltip"
      className={cn(TOOLTIP, "top-0 max-w-[calc(50%-0.5rem)]")}
      style={onRight ? { left: x + 8 } : { right: width - x + 8 }}
    >
      <TooltipBody point={point} series={series} unit={unit} variant={variant} />
    </div>
  )
}

/** Where a sparkline's line lies in the window (its box's left, top and bottom, in px). */
export interface TipAnchor {
  readonly left: number
  readonly top: number
  readonly bottom: number
}

/** The tooltip's room from its line and from the window's edges. */
const TIP_GAP = 4

interface TipPlacement {
  top: number
  left: number
}

/**
 * Above the line from its start, below it where the window has no room above, and never past a
 * side of the window: it is placed in the window, so no box around the line clips it.
 */
export function placeTip(
  anchor: TipAnchor,
  tip: { width: number; height: number },
  view: { width: number; height: number },
): TipPlacement {
  const above = anchor.top - TIP_GAP - tip.height
  const below = anchor.bottom + TIP_GAP
  const top =
    above >= TIP_GAP || below + tip.height > view.height - TIP_GAP
      ? Math.max(TIP_GAP, above)
      : below
  const left = Math.max(TIP_GAP, Math.min(anchor.left, view.width - TIP_GAP - tip.width))
  return { top, left }
}

/**
 * A sparkline's tooltip, as wide as its figures need (at most 256 px): portaled and placed
 * `fixed` against the line's box in the window, so a frame that clips its content (a KPI tile's
 * strip, a panel) never cuts it. Measured hidden first, then placed, before the browser paints.
 */
export function SparklineTooltip({
  anchor,
  ...props
}: {
  point: ChartPoint
  series: readonly SlottedSeries[]
  unit: ChartUnit
  anchor: TipAnchor
}) {
  const portal = usePortalContainer()
  const [placement, setPlacement] = useState<TipPlacement | null>(null)
  const measure = useCallback(
    (element: HTMLSpanElement | null) => {
      if (!element) return
      const view = element.ownerDocument.defaultView
      const { width, height } = element.getBoundingClientRect()
      setPlacement(
        placeTip(
          anchor,
          { width, height },
          { width: view?.innerWidth ?? Infinity, height: view?.innerHeight ?? Infinity },
        ),
      )
    },
    // Every move of the pointer brings a new anchor, a new point with it: measured again.
    [anchor],
  )
  const target = portal ?? globalThis.document?.body
  if (!target) return null
  return createPortal(
    <span
      ref={measure}
      aria-hidden="true"
      data-slot="chart-tooltip"
      className={cn(TOOLTIP, "fixed z-50 max-w-64")}
      style={
        placement
          ? { top: placement.top, left: placement.left }
          : { top: 0, left: 0, visibility: "hidden" }
      }
    >
      <TooltipBody {...props} variant="line" />
    </span>,
    target,
  )
}

/**
 * The chart as a table for a screen reader, visually hidden: its caption the chart's name, a
 * row per point, a column per series, each value in words (`at least 2,000`, `count unknown`).
 * The box around it hides it: a table takes no 1 px width and clips nothing itself, so an
 * `sr-only` table still widens the page by its columns.
 */
export function ChartTable({
  label,
  categoryLabel,
  series,
  points,
  unit,
  hidden,
}: {
  label: string
  categoryLabel: string
  series: readonly SlottedSeries[]
  points: readonly ChartPoint[]
  unit: ChartUnit
  /** Left out entirely (inside a button, whose name it would join). */
  hidden?: boolean
}) {
  const words = useUiMessages()
  const locale = useUiLocale()
  return (
    <span data-slot="chart-table" className="sr-only" hidden={hidden}>
      <table>
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">{categoryLabel}</th>
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.key}>
              <th scope="row">{point.description ?? point.label}</th>
              {series.map((s) => (
                <td key={s.key}>
                  {valueText(point.values[s.key] ?? null, unit, words, locale).spoken}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </span>
  )
}

/** A hairline on whole pixels, so it draws one pixel wide, never two half-lit ones. */
const crisp = (y: number) => Math.round(y) + 0.5

/** The value axis: a hairline per tick behind the marks, the zero line stronger, its labels left. */
export function ValueAxis({
  ticks,
  labels,
  y,
  left,
  right,
}: {
  ticks: readonly number[]
  labels: readonly string[]
  y: (value: number) => number
  left: number
  right: number
}) {
  return (
    <g data-slot="chart-value-axis">
      {ticks.map((tick, i) => (
        <g key={tick}>
          <line
            x1={left}
            x2={right}
            y1={crisp(y(tick))}
            y2={crisp(y(tick))}
            className={i === 0 ? PLOT.zero : PLOT.grid}
          />
          <text x={left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className={PLOT.label}>
            {labels[i]}
          </text>
        </g>
      ))}
    </g>
  )
}

/** The point axis' labels the layout kept, on their line under the plot. */
export function PointAxis({
  placed,
  points,
  y,
}: {
  placed: readonly PlacedLabel[]
  points: readonly ChartPoint[]
  y: number
}) {
  return (
    <g data-slot="chart-point-axis">
      {placed.map((label) => (
        <text
          key={points[label.index]?.key ?? label.index}
          x={label.x}
          y={y}
          textAnchor={label.anchor}
          className={PLOT.label}
        >
          {points[label.index]?.label}
        </text>
      ))}
    </g>
  )
}

/** How many steps a value axis of `height` px takes: one per 48 px, two to five. */
export function axisIntervals(height: number): number {
  return Math.min(5, Math.max(2, Math.round(height / 48)))
}
