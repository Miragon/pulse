// Replaced by @miragon/pulse-ui's BarChart once Miragon/pulse#663 lands.
import { formatNumber } from "@miragon/pulse-ui"

export interface BarSeries {
  key: string
  label: string
  /** The bar's fill and the legend's swatch: one step of the info ramp, never green, never a tone. */
  fill: "fill-chart-1" | "fill-chart-3"
  swatch: "bg-chart-1" | "bg-chart-3"
}

export interface BarPoint {
  key: string
  /** The axis label (shown for the first, the middle and the last point). */
  label: string
  /** The point in words, for the tooltip and the table a screen reader reads. */
  description: string
  /** One value per series, in the series' order. */
  values: readonly number[]
}

export interface BarChartProps {
  /** Names the chart and its table. */
  label: string
  series: readonly BarSeries[]
  points: readonly BarPoint[]
  /** The plot's height in px. */
  height?: number
}

const GROUP = 12
const GAP = 1

/**
 * Grouped bars over time on the info ramp, the dashboard's started and ended per day: one group
 * per point, one bar per series, a rule at the top value and at the base line, the legend above,
 * three axis labels below. The drawing is an image (`aria-hidden`); a screen reader reads the same
 * numbers from the table under it, and each group's numbers show as its tooltip.
 */
export function BarChart({ label, series, points, height = 160 }: BarChartProps) {
  const max = Math.max(1, ...points.flatMap((point) => point.values))
  const width = points.length * GROUP
  const bar = (GROUP - 2 * GAP - (series.length - 1) * GAP) / series.length
  const ticks = [0, Math.floor((points.length - 1) / 2), points.length - 1]
  return (
    <figure className="m-0 flex flex-col gap-2">
      <figcaption className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={`${s.swatch} inline-block size-3 rounded-sm`} />
            {s.label}
          </span>
        ))}
      </figcaption>
      <div className="flex gap-2">
        <div
          aria-hidden="true"
          className="text-muted-foreground flex flex-col justify-between text-right tabular-nums"
          style={{ height }}
        >
          <span className="-translate-y-1/2">{formatNumber(max)}</span>
          <span className="translate-y-1/2">{formatNumber(0)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <svg
            aria-hidden="true"
            viewBox={`0 0 ${String(width)} ${String(height)}`}
            preserveAspectRatio="none"
            width="100%"
            height={height}
            className="block overflow-visible"
          >
            <line
              x1={0}
              x2={width}
              y1={0.5}
              y2={0.5}
              className="stroke-border"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={0}
              x2={width}
              y1={height - 0.5}
              y2={height - 0.5}
              className="stroke-muted-foreground"
              vectorEffect="non-scaling-stroke"
            />
            {points.map((point, p) => (
              <g key={point.key}>
                <title>{point.description}</title>
                <rect
                  x={p * GROUP}
                  y={0}
                  width={GROUP}
                  height={height}
                  className="fill-transparent"
                />
                {series.map((s, i) => {
                  const value = point.values[i] ?? 0
                  const h = (value / max) * (height - 1)
                  return (
                    <rect
                      key={s.key}
                      x={p * GROUP + GAP + i * (bar + GAP)}
                      y={height - 1 - h}
                      width={bar}
                      height={h}
                      className={s.fill}
                    />
                  )
                })}
              </g>
            ))}
          </svg>
          <div
            aria-hidden="true"
            className="text-muted-foreground mt-1 flex justify-between gap-2 tabular-nums"
          >
            {ticks.map((t, i) => (
              <span key={`${String(t)}-${String(i)}`}>{points[t]?.label}</span>
            ))}
          </div>
        </div>
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col" />
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
              <th scope="row">{point.label}</th>
              {series.map((s, i) => (
                <td key={s.key}>{formatNumber(point.values[i] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
