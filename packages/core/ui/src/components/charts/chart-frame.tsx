import type { ComponentType, ReactNode } from "react"
import { useUiLocale } from "../../locale/locale-provider.js"
import { cn } from "../../lib/utils.js"
import { gutterWidth, placeLabels, slots, type PlacedLabel, type Slots } from "./chart-layout.js"
import {
  axisIntervals,
  ChartLegend,
  ChartTable,
  ChartTooltip,
  PLOT_TARGET,
  PLOT_TOP,
  POINT_AXIS,
  useActivePoint,
  useChartWidth,
} from "./chart-parts.js"
import { slotSeries, type SlottedSeries } from "./chart-series.js"
import type { ChartPoint, ChartSeries, ChartUnit } from "./chart-types.js"
import { maxOf, niceTicks, tickText } from "./chart-values.js"

/** What `BarChart` and `LineChart` take: the same props, a different drawing. */
export interface CartesianChartProps {
  /** Names the chart: the plot's accessible name and the caption of its table. */
  label: string
  /** What the points are ("Day", "Hour"): the head of the table's first column. */
  categoryLabel: string
  series: readonly ChartSeries[]
  /** The points along the axis, in their order (the oldest first). */
  points: readonly ChartPoint[]
  /** What the values are; default counts. */
  unit?: ChartUnit
  /** The plot's height in px, default 160; the axis' labels add their line below it. */
  height?: number
  className?: string
}

/** What a drawing gets: the measured width and everything laid out for it. */
export interface PlotProps {
  width: number
  height: number
  /** The zero line's y; the plot runs from {@link PLOT_TOP} down to it. */
  base: number
  /** The drawing's full height: the plot and the point axis' line under it. */
  total: number
  geometry: Slots
  ticks: readonly number[]
  tickLabels: readonly string[]
  /** The point labels that fit, the latest always among them. */
  placed: readonly PlacedLabel[]
  series: readonly SlottedSeries[]
  points: readonly ChartPoint[]
  /** The hovered or focused point, if any. */
  active: number | null
}

/** The `<svg>` every drawing is: as wide as measured, never wider than its box. */
export function PlotSvg({
  width,
  total,
  children,
}: {
  width: number
  total: number
  children: ReactNode
}) {
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={total}
      viewBox={`0 0 ${String(width)} ${String(total)}`}
      className="block max-w-full overflow-visible forced-colors:forced-color-adjust-none"
    >
      {children}
    </svg>
  )
}

/**
 * The frame both charts share: the legend, the measured plot as one tab stop with its tooltip,
 * the hidden table; the value axis from zero to a round top over every series' values, the
 * point labels that fit. Before the width is measured (a server render) the plot keeps its
 * height empty, so nothing jumps once it draws.
 */
export function CartesianChart({
  name,
  variant,
  Plot,
  label,
  categoryLabel,
  series,
  points,
  unit = "count",
  height = 160,
  className,
}: CartesianChartProps & {
  name: "BarChart" | "LineChart"
  variant: "bar" | "line"
  Plot: ComponentType<PlotProps>
}) {
  const slotted = slotSeries(name, series)
  const locale = useUiLocale()
  const [attach, width] = useChartWidth()
  const values = points.flatMap((p) => slotted.map((s) => p.values[s.key]))
  const ticks = niceTicks(maxOf(values), unit, axisIntervals(height))
  const tickLabels = ticks.map((t) => tickText(t, unit, ticks, locale))
  const geometry = width ? slots(points.length, gutterWidth(tickLabels), width) : null
  const { index, handlers } = useActivePoint(points.length, (x) => geometry?.indexAt(x) ?? 0)
  const point = index === null ? undefined : points[index]
  const base = PLOT_TOP + height
  const total = base + POINT_AXIS
  return (
    <div data-slot={`${variant}-chart`} className={cn("flex min-w-0 flex-col gap-2", className)}>
      <ChartLegend series={slotted} variant={variant} />
      <div ref={attach} className="relative min-w-0">
        <div
          role="group"
          aria-label={label}
          tabIndex={0}
          className={PLOT_TARGET}
          style={{ height: total }}
          {...handlers}
        >
          {geometry && width && (
            <Plot
              width={width}
              height={height}
              base={base}
              total={total}
              geometry={geometry}
              ticks={ticks}
              tickLabels={tickLabels}
              placed={placeLabels(
                points.map((p) => p.label),
                geometry.center,
                geometry.step,
                0,
                width,
              )}
              series={slotted}
              points={points}
              active={index}
            />
          )}
        </div>
        {geometry && width && point && index !== null && (
          <ChartTooltip
            point={point}
            series={slotted}
            unit={unit}
            variant={variant}
            x={geometry.center(index)}
            width={width}
          />
        )}
      </div>
      <ChartTable
        label={label}
        categoryLabel={categoryLabel}
        series={slotted}
        points={points}
        unit={unit}
      />
    </div>
  )
}
