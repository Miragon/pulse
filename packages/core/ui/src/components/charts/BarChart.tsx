import { barPath, barSlot, scaleY, type Slots } from "./chart-layout.js"
import { CartesianChart, PlotSvg, type CartesianChartProps, type PlotProps } from "./chart-frame.js"
import { PLOT_TOP, PointAxis, ValueAxis } from "./chart-parts.js"
import { BAR_FILL, PLOT, type SlottedSeries } from "./chart-series.js"
import type { ChartPoint } from "./chart-types.js"
import { boundOf } from "./chart-values.js"

export interface BarChartProps extends CartesianChartProps {
  /**
   * One or two series on the blue ramp, told apart by lightness and by their place in each
   * group, and any incident series in the danger tone. A third series on the ramp throws.
   */
  series: CartesianChartProps["series"]
}

/** The bars of one point, side by side in their series' order, each from the zero line up. */
function BarGroup({
  point,
  index,
  series,
  geometry,
  y,
  base,
}: {
  point: ChartPoint
  index: number
  series: readonly SlottedSeries[]
  geometry: Slots
  y: (value: number) => number
  base: number
}) {
  const bar = barSlot(geometry.step, series.length)
  const start = geometry.left + index * geometry.step + bar.offset
  return (
    <g>
      {series.map((s, j) => {
        const n = boundOf(point.values[s.key] ?? null)
        if (n === null || n <= 0) return null
        return (
          <path
            key={s.key}
            data-slot="chart-mark"
            data-series={s.slot}
            d={barPath(start + j * (bar.width + bar.gap), bar.width, y(n), base)}
            className={BAR_FILL[s.slot]}
          />
        )
      })}
    </g>
  )
}

/** The drawing: the hovered group's band, the grid, the bars, the point labels. */
function BarPlot(props: PlotProps) {
  const { width, height, base, total, geometry, ticks, tickLabels, active } = props
  const y = scaleY(ticks[ticks.length - 1] ?? 0, base, height)
  return (
    <PlotSvg width={width} total={total}>
      {active !== null && (
        <rect
          data-slot="chart-band"
          x={geometry.left + active * geometry.step}
          y={PLOT_TOP}
          width={geometry.step}
          height={height}
          className={PLOT.band}
        />
      )}
      <ValueAxis ticks={ticks} labels={tickLabels} y={y} left={geometry.left} right={width} />
      {props.points.map((point, index) => (
        <BarGroup
          key={point.key}
          point={point}
          index={index}
          series={props.series}
          geometry={geometry}
          y={y}
          base={base}
        />
      ))}
      <PointAxis placed={props.placed} points={props.points} y={total - 6} />
    </PlotSvg>
  )
}

/**
 * Bars over days or categories in the Pulse look, grouped by point, on a fixed axis from zero:
 * started and ended per day, say. Each bar is at most 24 px wide with its data end rounded and
 * 2 px of the surface between the bars of a group; a lower bound draws to its bound, a value
 * nobody read draws nothing (the tooltip and the table say which). The axis keeps the labels
 * that fit, the latest always. The plot is one tab stop: hovering a group, or the arrow keys on
 * it, shows the group's figures in a tooltip. A legend names two series or more; a screen reader
 * reads the chart as its table. It fills its container's width, measured, and never runs past
 * it.
 */
export function BarChart(props: BarChartProps) {
  return <CartesianChart name="BarChart" variant="bar" Plot={BarPlot} {...props} />
}
