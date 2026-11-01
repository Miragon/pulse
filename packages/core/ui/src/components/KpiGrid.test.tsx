import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { attribute, openingTags, userFacingTexts } from "../render-scan.js"
import { TONE_ICON } from "../lib/tone-utils.js"
import { KpiGrid, KpiGridSkeleton, kpiColumns } from "./KpiGrid.js"

/**
 * The lifted (widget-shell) KpiGrid on its SSR markup: responsive columns,
 * neutral figures with the state as a dot or a Lucide icon, and clickable
 * cells whose accessible name is what you SEE (WCAG 2.5.3) while the action
 * goes into the description.
 */

const noop = (): void => {}
const classOf = (tag: string | undefined) => attribute(tag ?? "", "class") ?? ""

/**
 * The strip's clipping frame, its grid and its cells (the grid's direct
 * children: plain boxes, or buttons when clickable), read off the markup.
 */
function strip(html: string) {
  const start = html.indexOf('data-slot="kpi-strip"')
  const tags = html.slice(start).match(/<(?:div|button)(?=[\s>])[^>]*>/g) ?? []
  const [grid, ...rest] = tags
  const frame = openingTags(html, "div").find((t) => /data-slot="kpi-strip"/.test(t))
  return { frame, grid, cells: rest.filter((t) => /\bborder-r border-b\b/.test(t)) }
}

const kpis = (count: number) =>
  Array.from({ length: count }, (_, idx) => ({ label: `KPI ${idx + 1}`, value: idx }))

describe("kpiColumns: responsive columns, clamped to 1–6", () => {
  it("falls back to 2 columns in narrow frames from 4 cells on", () => {
    expect(kpiColumns(1)).toBe("grid-cols-1")
    expect(kpiColumns(2)).toBe("grid-cols-2")
    expect(kpiColumns(3)).toBe("grid-cols-3")
    expect(kpiColumns(4)).toBe("grid-cols-2 sm:grid-cols-4")
    expect(kpiColumns(5)).toBe("grid-cols-2 sm:grid-cols-5")
    expect(kpiColumns(6)).toBe("grid-cols-2 sm:grid-cols-3 lg:grid-cols-6")
  })

  it("clamps out-of-range counts instead of dropping the grid", () => {
    expect(kpiColumns(0)).toBe("grid-cols-1")
    expect(kpiColumns(-3)).toBe("grid-cols-1")
    expect(kpiColumns(Number.NaN)).toBe("grid-cols-1")
    expect(kpiColumns(9)).toBe(kpiColumns(6))
    expect(kpiColumns(4.7)).toBe(kpiColumns(4))
  })
})

describe("KpiGrid strip: neutral figures, the state beside them", () => {
  const html = renderToStaticMarkup(
    <KpiGrid
      cells={[
        { label: "Open incidents", value: 18, tone: "danger" },
        { label: "Legacy", value: 2, tone: "critical" },
        { label: "Running", value: 40, tone: "neutral" },
        { label: "Plain", value: 7, fraction: "/9" },
      ]}
    />,
  )

  it("draws the tone as a decorative dot, the alias 'critical' as danger", () => {
    const dots = openingTags(html, "span").filter((t) => /data-tone=/.test(t))
    expect(dots.map((t) => attribute(t, "data-tone"))).toEqual(["danger", "danger"])
    for (const dot of dots) {
      expect(attribute(dot, "aria-hidden")).toBe("true")
      expect(classOf(dot)).toContain("bg-danger")
    }
  })

  it("keeps every figure in the foreground at the page-title size", () => {
    expect(html).toMatch(/class="text-title text-foreground[^"]*tabular-nums">18</)
    expect(html).not.toMatch(/text-(?:danger|warning|success|info)(?:-ink)?\b/)
  })

  it("flows 4 cells responsively with wrap-safe dividers", () => {
    const { frame, grid, cells } = strip(html)
    expect(classOf(grid)).toContain("grid-cols-2 sm:grid-cols-4")
    expect(classOf(frame)).toContain("border-y")
    expect(cells).toHaveLength(4)
  })

  it("renders no text below the 13 px floor", () => {
    expect(html).not.toMatch(/text-xs|text-\[\d+px\]|uppercase/)
    expect(html).toContain("text-small")
  })
})

describe("KpiGrid strip: an incomplete last row keeps the card colour", () => {
  // 5 cells in 2 columns (a narrow inline frame) and 7 in 6 (lg) leave empty
  // tracks. Whatever shows through them is the frame's background, so the
  // dividers belong on the cells and the frame is the card.
  it.each([5, 7])("%i cells: dividers on every cell, nothing paints in the divider colour", (n) => {
    const html = renderToStaticMarkup(<KpiGrid cells={kpis(n)} />)
    const { frame, grid, cells } = strip(html)
    expect(classOf(grid)).toContain(kpiColumns(n))
    expect(classOf(frame)).toContain("bg-card")
    // The grid reaches 1 px past the clipping frame: the outer rules fall away.
    expect(classOf(frame)).toContain("overflow-hidden")
    expect(classOf(grid)).toMatch(/(^| )-mr-px -mb-px grid( |$)/)
    expect(cells).toHaveLength(n)
    for (const cell of cells) {
      expect(classOf(cell)).toContain("border-border")
      expect(classOf(cell)).not.toMatch(/(^| )bg-/)
    }
    expect(html).not.toMatch(/\bbg-border\b|\bgap-px\b/)
  })

  it("clickable cells carry the same dividers under their hover surface", () => {
    const html = renderToStaticMarkup(
      <KpiGrid cells={kpis(5).map((cell) => ({ ...cell, onClick: noop }))} />,
    )
    const { cells } = strip(html)
    expect(cells).toHaveLength(5)
    for (const cell of cells) expect(classOf(cell)).toContain("hover:bg-muted")
  })
})

describe("KpiGrid clickable cells (WCAG 2.5.3, label in name)", () => {
  const html = renderToStaticMarkup(
    <KpiGrid
      cells={[
        {
          label: "Open incidents",
          value: 18,
          tone: "danger",
          onClick: noop,
          actionHint: "Opens the incidents dashboard",
        },
        { label: "Running", value: 40, onClick: noop },
      ]}
    />,
  )
  const [first, second] = openingTags(html, "button")

  it("names a clickable cell by its visible label and value, never an aria-label", () => {
    expect(attribute(first ?? "", "aria-label")).toBeUndefined()
    expect(attribute(second ?? "", "aria-label")).toBeUndefined()
    const button = html.slice(html.indexOf("<button"), html.indexOf("</button>"))
    const visible = userFacingTexts(button.replace(/<span id="[^"]*" hidden="">[^<]*<\/span>/, ""))
    expect(visible.map((t) => t.value)).toEqual(["Open incidents", "18"])
  })

  it("describes the action through aria-describedby on a hidden hint", () => {
    const describedBy = attribute(first ?? "", "aria-describedby")
    expect(describedBy).toBeTruthy()
    const hint = openingTags(html, "span").find((t) => attribute(t, "id") === describedBy)
    expect(hint).toBeDefined()
    expect(attribute(hint ?? "", "hidden")).toBe("")
    expect(html).toContain(`id="${describedBy}" hidden="">Opens the incidents dashboard</span>`)
    expect(attribute(second ?? "", "aria-describedby")).toBeUndefined()
  })

  it("is a native button with the kit's inset focus ring and a Lucide chevron, no glyph", () => {
    expect(attribute(first ?? "", "type")).toBe("button")
    expect(classOf(first)).toContain("focus-visible:ring-inset")
    expect(classOf(first)).toContain("outline-hidden")
    expect(html).toMatch(/<svg[^>]*class="lucide lucide-chevron-right[^"]*"/)
    for (const svg of openingTags(html, "svg")) expect(attribute(svg, "aria-hidden")).toBe("true")
    expect(html).not.toContain("›")
  })

  it("still applies a legacy ariaLabel (deprecated) for existing callers", () => {
    const legacy = renderToStaticMarkup(
      <KpiGrid cells={[{ label: "Total", value: 19, onClick: noop, ariaLabel: "Show all" }]} />,
    )
    expect(attribute(openingTags(legacy, "button")[0] ?? "", "aria-label")).toBe("Show all")
  })
})

describe("KpiGrid trend line: neutral words, the state as an icon or a dot", () => {
  const html = renderToStaticMarkup(
    <KpiGrid
      cells={[
        { label: "Up", value: 1, trend: "+12%", trendDirection: "up" },
        { label: "Down", value: 2, trend: "-4%", trendDirection: "down" },
        { label: "Override", value: 3, trend: "-3", trendDirection: "down", trendTone: "neutral" },
        { label: "Dot", value: 4, trend: "+2", trendTone: "warning" },
        { label: "Flat", value: 5, trend: "±0", trendDirection: "flat" },
        { label: "Plain", value: 6, trend: "same" },
      ]}
    />,
  )
  const trends = html.split('data-slot="kpi-trend"').slice(1)

  it("draws a Lucide direction icon in the direction's tone (up = worse)", () => {
    expect(trends[0]).toMatch(/lucide-trending-up/)
    expect(trends[0]).toContain(TONE_ICON.danger)
    expect(trends[1]).toMatch(/lucide-trending-down/)
    expect(trends[1]).toContain(TONE_ICON.success)
    expect(trends[4]).toMatch(/lucide-minus/)
  })

  it("lets trendTone override the direction's tone, and draws a dot without a direction", () => {
    expect(trends[2]).toMatch(/lucide-trending-down/)
    expect(trends[2]).toContain(TONE_ICON.neutral)
    expect(trends[3]).not.toContain("<svg")
    expect(trends[3]).toMatch(/data-tone="warning"[^>]*class="[^"]*bg-warning/)
  })

  it("keeps the trend words in the foreground next to a state, quiet without one", () => {
    expect(trends[0]).toMatch(/<span class="text-foreground">\+12%<\/span>/)
    expect(trends[3]).toMatch(/<span class="text-foreground">\+2<\/span>/)
    expect(trends[2]).toMatch(/<span class="text-muted-foreground">-3<\/span>/)
    expect(trends[5]).toMatch(/<span class="text-muted-foreground">same<\/span>/)
    expect(trends[5]).not.toMatch(/<svg|data-tone/)
  })
})

describe("KpiGrid soft variant, group and header", () => {
  it("soft: each cell a card in its tone's tint and edge around foreground text", () => {
    const html = renderToStaticMarkup(
      <KpiGrid
        variant="soft"
        cells={[
          { label: "Failed", value: 4, tone: "danger", onClick: noop, actionHint: "Open" },
          { label: "Total", value: 12 },
        ]}
      />,
    )
    const failed = openingTags(html, "button")[0] ?? ""
    expect(classOf(failed)).toMatch(/bg-danger-soft/)
    expect(classOf(failed)).toMatch(/border-danger/)
    expect(classOf(failed)).toMatch(/text-foreground/)
    expect(classOf(failed)).toContain("focus-visible:ring-offset-2")
    const total = openingTags(html, "div").find((t) => /bg-muted/.test(t) && /rounded-lg/.test(t))
    expect(classOf(total)).toContain("border-border")
    expect(html).not.toMatch(/border-y/)
  })

  it("names the group when asked and renders the header label in normal case at 13 px", () => {
    const html = renderToStaticMarkup(
      <KpiGrid
        boxed
        ariaLabel="Health"
        header={{ label: "Status", badge: "live" }}
        cells={[{ label: "Up", value: 1 }]}
      />,
    )
    const root = openingTags(html, "div")[0] ?? ""
    expect(attribute(root, "role")).toBe("group")
    expect(attribute(root, "aria-label")).toBe("Health")
    expect(classOf(root)).toContain("rounded-lg border")
    expect(html).toMatch(/text-small font-semibold[^"]*"><span>Status<\/span>/)
    expect(html).toContain(">live</span>")
    const unnamed = renderToStaticMarkup(<KpiGrid cells={[{ label: "Up", value: 1 }]} />)
    expect(attribute(openingTags(unnamed, "div")[0] ?? "", "role")).toBeUndefined()
  })
})

describe("KpiGridSkeleton mirrors the grid's geometry", () => {
  it("strip: busy, one placeholder cell per KPI, the same responsive columns", () => {
    const html = renderToStaticMarkup(<KpiGridSkeleton cells={4} />)
    expect(attribute(openingTags(html, "div")[0] ?? "", "aria-busy")).toBe("true")
    expect(strip(html).cells).toHaveLength(4)
    expect(html).toContain("grid-cols-2 sm:grid-cols-4")
  })

  it("strip: an incomplete last row while loading has the loaded grid's frame, grid and cells", () => {
    const loading = strip(renderToStaticMarkup(<KpiGridSkeleton cells={5} />))
    const loaded = strip(renderToStaticMarkup(<KpiGrid cells={kpis(5)} />))
    expect(classOf(loading.frame)).toBe(classOf(loaded.frame))
    expect(classOf(loading.grid)).toBe(classOf(loaded.grid))
    expect(loading.cells.map(classOf)).toEqual(loaded.cells.map(classOf))
    // Only the placeholder bars take the border colour, never the surface behind a track.
    for (const tag of [loading.frame, loading.grid, ...loading.cells]) {
      expect(classOf(tag)).not.toMatch(/\bbg-border\b/)
    }
  })

  it("soft and boxed variants keep the loaded card shapes", () => {
    const soft = renderToStaticMarkup(<KpiGridSkeleton cells={3} variant="soft" />)
    expect(openingTags(soft, "div").filter((t) => /rounded-lg border p-4/.test(t))).toHaveLength(3)
    const boxed = renderToStaticMarkup(<KpiGridSkeleton cells={2} boxed />)
    expect(classOf(openingTags(boxed, "div")[0])).toContain("rounded-lg border")
    expect(renderToStaticMarkup(<KpiGridSkeleton cells={-1} />)).not.toContain("px-5 py-4")
  })
})
