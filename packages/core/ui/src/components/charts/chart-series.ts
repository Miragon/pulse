import type { ChartSeries } from "./chart-types.js"

/**
 * Which colour each series takes, in one fixed order: the first series on the blue ramp
 * `--chart-1`, the second `--chart-2`, told apart by lightness (theme.css documents the steps
 * and `chart-ramp.test.ts` measures them in light and dark), and an incident series in
 * `--danger`, the one red. Never green, never another tone. Under forced colours the browser
 * repaints nothing in an SVG, so each slot names its system colours: the first in CanvasText,
 * the second hollow (Canvas inside a CanvasText edge on a bar, dashed on a line), incidents in
 * Highlight.
 */
export type SeriesSlot = "first" | "second" | "incident"

/** The ramp holds two series at 3:1 on every surface (owner decision 2026-11-24). */
const RAMP_SERIES_MAX = 2

/** A series with the slot its colour comes from. */
export interface SlottedSeries extends ChartSeries {
  slot: SeriesSlot
}

/**
 * The series in their given order, each with its slot. A chart takes at most two series on the
 * ramp and any number of incident series; a third series on the ramp would fall below 3:1 on
 * light or drop the lightness that tells it apart, so it throws: split the chart, or show the
 * shares as `MeterRows`.
 */
export function slotSeries(chart: string, series: readonly ChartSeries[]): SlottedSeries[] {
  let ramp = 0
  return series.map((s) => {
    if (s.kind === "incident") return { ...s, slot: "incident" as const }
    ramp += 1
    if (ramp > RAMP_SERIES_MAX) {
      throw new RangeError(
        `${chart} draws at most ${String(RAMP_SERIES_MAX)} series on the blue ramp, plus incidents in red; "${s.key}" is the ${String(ramp)}th. Split the chart, or show the shares as MeterRows.`,
      )
    }
    return { ...s, slot: ramp === 1 ? ("first" as const) : ("second" as const) }
  })
}

/** A bar's fill, and a legend swatch's, per slot. */
export const BAR_FILL: Readonly<Record<SeriesSlot, string>> = {
  first: "fill-chart-1 forced-colors:fill-[CanvasText]",
  second: "fill-chart-2 forced-colors:fill-[Canvas] forced-colors:stroke-[CanvasText]",
  incident: "fill-danger forced-colors:fill-[Highlight]",
}

/** A line's stroke, and a legend key's, per slot. */
export const LINE_STROKE: Readonly<Record<SeriesSlot, string>> = {
  first: "stroke-chart-1 forced-colors:stroke-[CanvasText]",
  second: "stroke-chart-2 forced-colors:stroke-[CanvasText]",
  incident: "stroke-danger forced-colors:stroke-[Highlight]",
}

/** A line's dot (the hovered point, a point alone between gaps), per slot. */
export const DOT_FILL: Readonly<Record<SeriesSlot, string>> = {
  first: "fill-chart-1 forced-colors:fill-[CanvasText]",
  second: "fill-chart-2 forced-colors:fill-[CanvasText]",
  incident: "fill-danger forced-colors:fill-[Highlight]",
}

/**
 * The second series' line is dashed in every mode: on one hue, lightness alone parts two lines
 * less than two hues would, so the dash is the second channel.
 */
export const LINE_DASH: Readonly<Record<SeriesSlot, string | undefined>> = {
  first: undefined,
  second: "6 4",
  incident: undefined,
}

/**
 * A meter row's fill, per slot (a row is on the ramp's first step or an incident). Under forced
 * colours theme.css paints every row's fill CanvasText and its track's outline, as a progress
 * bar's: a row names what it counts, so its colour tells nothing its words do not.
 */
export const METER_FILL: Readonly<Record<"first" | "incident", string>> = {
  first: "bg-chart-1",
  incident: "bg-danger",
}

/**
 * The quiet parts of a plot: the grid and the crosshair in hairlines (the zero line stronger),
 * the labels, the hovered group's band, the 2 px ring of the surface around a dot. The band lies
 * under the hovered bars, so it is a surface the series keep 3:1 on (`--muted`, a meter's track,
 * in `ROLE_CONTRAST_PAIRS`), never the hover's `--accent`, on which the second series is not.
 * Stroke widths are classes: the kit's `strokeWidth` attribute is the Lucide stroke's
 * (`ICON_STROKE`).
 */
export const PLOT = {
  grid: "stroke-border stroke-1 forced-colors:stroke-[GrayText]",
  zero: "stroke-muted-foreground stroke-1 forced-colors:stroke-[CanvasText]",
  label: "fill-muted-foreground text-small tabular-nums forced-colors:fill-[CanvasText]",
  band: "fill-muted forced-colors:fill-[Canvas] forced-colors:stroke-[Highlight]",
  crosshair: "stroke-muted-foreground stroke-1 forced-colors:stroke-[CanvasText]",
  ring: "stroke-card stroke-2 forced-colors:stroke-[Canvas]",
} as const

/** A line's width, as a class (see {@link PLOT}). */
export const LINE_WIDTH = "stroke-2"
