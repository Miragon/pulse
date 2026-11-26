import type { Count } from "../../format/index.js"

/**
 * What a chart's numbers are: counts (the default, `Count`: exact, a lower bound `{ atLeast }`,
 * unknown `null`), durations in milliseconds, or percent units (3.7 is 3.7 %). The unit picks the
 * kit formatter that writes the axis, the tooltip and the table.
 */
export type ChartUnit = "count" | "duration" | "percent"

/** One series of a `BarChart` or a `LineChart`. */
export interface ChartSeries {
  /** The key of this series' value in each point's `values`. */
  key: string
  /** Its name in the legend, the tooltip and the head of its column in the table. */
  label: string
  /**
   * `"incident"` paints the series in the danger tone: open incidents only, the one red a chart
   * draws. Every other series takes the next step of the blue ramp (`--chart-1`, `--chart-2`).
   */
  kind?: "incident"
}

/** One point on a chart's axis: a bucket of time (a day, an hour) or a category. */
export interface ChartPoint {
  /** Unique among the chart's points. */
  key: string
  /**
   * The point's label on the axis, short and formatted by you through the kit's formatters
   * (`formatDate`, `formatTime`). Labels that would collide are left out of the axis, the last
   * one always kept; the tooltip and the table name every point.
   */
  label: string
  /** The point in full, for its tooltip and its row in the table; default its label. */
  description?: string
  /** One value per series key; a missing key is an unknown value (`null`), never a 0. */
  values: Readonly<Record<string, Count>>
}
