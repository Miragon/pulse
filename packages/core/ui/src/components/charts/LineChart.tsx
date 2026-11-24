import { cn } from "../../lib/utils.js"
import { linePath, scaleY, type Slots } from "./chart-layout.js"
import { CartesianChart, PlotSvg, type CartesianChartProps, type PlotProps } from "./chart-frame.js"
import { PLOT_TOP, PointAxis, ValueAxis } from "./chart-parts.js"
import {
  DOT_FILL,
  LINE_DASH,
  LINE_STROKE,
  LINE_WIDTH,
  PLOT,
  type SlottedSeries,
} from "./chart-series.js"
import type { ChartPoint } from "./chart-types.js"
import { boundOf } from "./chart-values.js"

export interface LineChartProps extends CartesianChartProps {
  /**
   * One or two series on the blue ramp (the second dashed) and any incident series in the
   * danger tone. A third series on the ramp throws.
   */
  series: CartesianChartProps["series"]
}

type At = { x: number; y: number } | null

/** Where each point of a series sits, `null` where it has no value (the line breaks there). */
function positions(
  series: SlottedSeries,
  points: readonly ChartPoint[],
  geometry: Slots,
  y: (value: number) => number,
): At[] {
  return points.map((point, i) => {
    const n = boundOf(point.values[series.key] ?? null)
    return n === null ? null : { x: geometry.center(i), y: y(n) }
  })
}

/** A value with no neighbour that has one: a line cannot draw it, so it is a dot. */
const lone = (at: readonly At[], i: number) => at[i] !== null && !at[i - 1] && !at[i + 1]

/** One series: its line, broken at a missing value, a dot where a value stands alone. */
function SeriesLine({
  series,
  at,
  active,
}: {
  series: SlottedSeries
  at: readonly At[]
  active: number | null
}) {
  const hovered = active === null ? null : at[active]
  return (
    <g data-slot="chart-mark" data-series={series.slot}>
      <path
        d={linePath(at)}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={LINE_DASH[series.slot]}
        className={cn(LINE_STROKE[series.slot], LINE_WIDTH)}
      />
      {at.map((p, i) =>
        p && lone(at, i) && i !== active ? (
          <circle key={i} cx={p.x} cy={p.y} r={4} className={DOT_FILL[series.slot]} />
        ) : null,
      )}
      {hovered && (
        <circle
          data-slot="chart-dot"
          cx={hovered.x}
          cy={hovered.y}
          r={4}
          className={cn(DOT_FILL[series.slot], PLOT.ring)}
        />
      )}
    </g>
  )
}

/** The drawing: the grid, the crosshair at the hovered point, the lines, the point labels. */
function LinePlot(props: PlotProps) {
  const { width, height, base, total, geometry, ticks, tickLabels, active } = props
  const y = scaleY(ticks[ticks.length - 1] ?? 0, base, height)
  const crosshair = active === null ? null : Math.round(geometry.center(active)) + 0.5
  return (
    <PlotSvg width={width} total={total}>
      <ValueAxis ticks={ticks} labels={tickLabels} y={y} left={geometry.left} right={width} />
      {crosshair !== null && (
        <line
          data-slot="chart-crosshair"
          x1={crosshair}
          x2={crosshair}
          y1={PLOT_TOP}
          y2={base}
          className={PLOT.crosshair}
        />
      )}
      {props.series.map((s) => (
        <SeriesLine
          key={s.key}
          series={s}
          at={positions(s, props.points, geometry, y)}
          active={active}
        />
      ))}
      <PointAxis placed={props.placed} points={props.points} y={total - 6} />
    </PlotSvg>
  )
}

/**
 * Series over time in the Pulse look, on a fixed axis from zero: a 2 px line per series, the
 * second dashed, broken where a point has no value. The plot is one tab stop: the pointer, or
 * the arrow keys on it, move a crosshair that snaps to the nearest point and shows every
 * series' figure there in a tooltip. A legend names two series or more; a screen reader reads
 * the chart as its table. It fills its container's width, measured, and never runs past it.
 */
export function LineChart(props: LineChartProps) {
  return <CartesianChart name="LineChart" variant="line" Plot={LinePlot} {...props} />
}
