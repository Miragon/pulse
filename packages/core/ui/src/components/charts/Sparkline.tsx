import { useCallback, useEffect, useState, type PointerEvent } from "react"
import type { Count } from "../../format/index.js"
import { cn } from "../../lib/utils.js"
import { linePath, scaleY, slots } from "./chart-layout.js"
import { ChartTable, SparklineTooltip, type TipAnchor, useChartWidth } from "./chart-parts.js"
import { DOT_FILL, LINE_STROKE, LINE_WIDTH, PLOT, type SlottedSeries } from "./chart-series.js"
import type { ChartPoint, ChartUnit } from "./chart-types.js"
import { boundOf, maxOf } from "./chart-values.js"

/** One point of a sparkline: a bucket of time and its value. */
export interface SparklinePoint {
  /** Unique among the line's points. */
  key: string
  /** The point's name in its tooltip and its row in the table, formatted by you (`formatDate`). */
  label: string
  value: Count
}

export interface SparklineProps {
  /**
   * What the line counts ("Started per day, last 14 days"): the caption of its table and the
   * head of the table's value column.
   */
  label: string
  /** What the points are ("Day"): the head of the table's first column. */
  categoryLabel: string
  /** The points, oldest first, one per bucket. */
  points: readonly SparklinePoint[]
  /** What the values are; default counts. */
  unit?: ChartUnit
  /** The line's height in px, default 24. */
  height?: number
  /** Its width: 112 px by default (`w-28`), `w-full` to fill a block. */
  className?: string
}

/** The one key a sparkline's points keep their value under. */
const VALUE = "value"

/** A dot's room inside the line's box: its radius and its ring, so none is cut at an edge. */
const INSET = 5

/** The points as the chart parts read them: one series under one key. */
function asChartPoints(points: readonly SparklinePoint[]): ChartPoint[] {
  return points.map((p) => ({ key: p.key, label: p.label, values: { [VALUE]: p.value } }))
}

/** The latest point that has a value, -1 when none has. */
function latestOf(at: readonly unknown[]): number {
  for (let i = at.length - 1; i >= 0; i--) if (at[i] !== null) return i
  return -1
}

/**
 * Whether the line sits inside a control (a clickable KPI tile is a button): its table would join
 * the control's name there, which the tile's own figure gives, so the table is left out.
 */
function useInsideControl() {
  const [inside, setInside] = useState(false)
  const attach = useCallback((node: HTMLElement | null) => {
    if (node) setInside(node.parentElement?.closest("button, a[href], [role='button']") != null)
  }, [])
  return [attach, inside] as const
}

/** The point the pointer is on and where the line lies in the window, for the tooltip. */
interface Hover {
  index: number
  anchor: TipAnchor
}

/** A scroll moves the line from under its tooltip, which is placed in the window: it closes. */
function useCloseOnScroll(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return
    window.addEventListener("scroll", close, true)
    return () => window.removeEventListener("scroll", close, true)
  }, [open, close])
}

/**
 * A trend in a line, for a `KpiGrid` cell's `trend` beside its figure: the ramp's first step on
 * an axis from zero, no grid and no labels, a dot on the latest value. Hovering it (pressing it
 * on touch) shows a point's figure above the line, placed in the window so the tile's clipping
 * frame never cuts it; a screen reader reads it as its table (left out inside a button, whose own
 * words name it). 112 px wide by default and never wider than its box.
 */
export function Sparkline({
  label,
  categoryLabel,
  points,
  unit = "count",
  height = 24,
  className,
}: SparklineProps) {
  const [measure, width] = useChartWidth()
  const [mark, insideControl] = useInsideControl()
  const [hover, setHover] = useState<Hover | null>(null)
  const close = useCallback(() => setHover(null), [])
  useCloseOnScroll(hover !== null, close)
  const active = hover?.index ?? null
  const chartPoints = asChartPoints(points)
  const series: SlottedSeries[] = [{ key: VALUE, label, slot: "first" }]
  const geometry = width ? slots(points.length, INSET, width - INSET) : null
  const y = scaleY(maxOf(points.map((p) => p.value)), height - INSET, height - 2 * INSET)
  const at = points.map((p, i) => {
    const n = boundOf(p.value)
    return geometry && n !== null ? { x: geometry.center(i), y: y(n) } : null
  })
  const dot = at[active ?? latestOf(at)] ?? null
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!geometry) return
    const box = event.currentTarget.getBoundingClientRect()
    setHover({
      index: geometry.indexAt(event.clientX - box.left),
      anchor: { left: box.left, top: box.top, bottom: box.bottom },
    })
  }
  const hovered = active === null ? undefined : chartPoints[active]
  return (
    <span
      ref={mark}
      data-slot="sparkline"
      className={cn("relative inline-block w-28 max-w-full align-middle", className)}
    >
      <span
        ref={measure}
        className="block"
        style={{ height }}
        onPointerDown={onPointerMove}
        onPointerMove={onPointerMove}
        onPointerLeave={close}
      >
        {width && (
          <svg
            aria-hidden="true"
            width={width}
            height={height}
            viewBox={`0 0 ${String(width)} ${String(height)}`}
            className="block max-w-full overflow-visible forced-colors:forced-color-adjust-none"
          >
            <path
              data-slot="chart-mark"
              data-series="first"
              d={linePath(at)}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn(LINE_STROKE.first, LINE_WIDTH)}
            />
            {dot && (
              <circle
                data-slot="chart-dot"
                cx={dot.x}
                cy={dot.y}
                r={3}
                className={cn(DOT_FILL.first, PLOT.ring)}
              />
            )}
          </svg>
        )}
      </span>
      {hovered && hover && (
        <SparklineTooltip point={hovered} series={series} unit={unit} anchor={hover.anchor} />
      )}
      <ChartTable
        label={label}
        categoryLabel={categoryLabel}
        series={series}
        points={chartPoints}
        unit={unit}
        hidden={insideControl}
      />
    </span>
  )
}
