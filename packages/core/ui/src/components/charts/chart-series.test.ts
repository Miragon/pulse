import { describe, expect, it } from "vitest"
import { ROLE_CONTRAST_PAIRS } from "../../testing/index.js"
import { rules } from "../../theme/theme-css.test-support.js"
import { compiled } from "../bar-css.test-support.js"
import {
  BAR_FILL,
  DOT_FILL,
  LINE_STROKE,
  LINE_WIDTH,
  METER_FILL,
  PLOT,
  slotSeries,
} from "./chart-series.js"

describe("slotSeries", () => {
  it("gives the ramp's steps in order and incidents the danger tone, wherever they stand", () => {
    expect(
      slotSeries("BarChart", [
        { key: "incidents", label: "Incidents", kind: "incident" },
        { key: "started", label: "Started" },
        { key: "ended", label: "Ended" },
      ]).map((s) => s.slot),
    ).toEqual(["incident", "first", "second"])
  })

  it("refuses a third series on the ramp and names it", () => {
    expect(() =>
      slotSeries("LineChart", [
        { key: "a", label: "A" },
        { key: "b", label: "B" },
        { key: "c", label: "C" },
      ]),
    ).toThrow(/LineChart draws at most 2 series on the blue ramp.*"c"/)
  })
})

/**
 * Every class a chart draws with compiles over the kit's theme to what it promises: the ramp's
 * roles, the danger tone, and under forced colours the system colours the browser does not set
 * on an SVG by itself. A typo in a class would style nothing, silently.
 */
describe("the marks' classes", () => {
  const classes = [
    ...Object.values(BAR_FILL),
    ...Object.values(LINE_STROKE),
    ...Object.values(DOT_FILL),
    ...Object.values(METER_FILL),
    ...Object.values(PLOT),
    LINE_WIDTH,
  ].flatMap((c) => c.split(/\s+/))

  it("each compile to a rule", async () => {
    const css = await compiled(classes)
    const missing = [...new Set(classes)].filter((c) => {
      const selector = c.replace(/[[\]():.]/g, (ch) => `\\${ch}`)
      return !css.includes(`.${selector}`)
    })
    expect(missing).toEqual([])
  })

  it("paint the ramp, the danger tone and the system colours under forced colours", async () => {
    const css = await compiled(classes)
    for (const fragment of [
      "fill: var(--chart-1)",
      "fill: var(--chart-2)",
      "stroke: var(--chart-1)",
      "fill: var(--danger)",
      "background-color: var(--chart-1)",
      "background-color: var(--danger)",
      "stroke-width: 2",
      "@media (forced-colors: active)",
      "fill: CanvasText",
      "fill: Highlight",
      "stroke: CanvasText",
    ]) {
      expect(css, fragment).toContain(fragment)
    }
  })
})

describe("the hovered bars' band", () => {
  it("is a surface the series and the incidents' red are measured 3:1 on", () => {
    const role = /(?:^|\s)fill-([a-z][\w-]*)/.exec(PLOT.band)?.[1]
    const surfaces = ROLE_CONTRAST_PAIRS.filter((pair) => pair.label.startsWith("chart mark"))
      .filter((pair) => ["--chart-1", "--chart-2", "--danger"].includes(pair.fg))
      .map((pair) => pair.bg)
    expect(surfaces.filter((bg) => bg === `--${String(role)}`)).toHaveLength(3)
  })
})

describe("a meter row under forced colours", () => {
  it("fills in CanvasText and outlines its track, as a progress bar does (theme.css)", () => {
    const css = rules.replace(/\s+/g, " ")
    const forced = css.slice(css.indexOf("@media (forced-colors: active)"))
    expect(forced).toMatch(
      /\[data-slot="meter-fill"\] \):not\(\[data-theme-mode="light"\] \*\) \{ background-color: CanvasText; \}/,
    )
    expect(forced).toContain('[data-slot="meter-track"] { outline: 1px solid CanvasText; }')
  })
})
