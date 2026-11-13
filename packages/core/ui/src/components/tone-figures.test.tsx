import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { ToneVariant } from "../tones/index.js"
import { KpiGrid } from "./KpiGrid.js"
import { CountPill, LivePill } from "./Pills.js"

/**
 * Status model (owner decision 2e-f, CI §3.3; owner decision (d) of D9): coloured digits are
 * retired. A figure (a KPI value, a trend, a count) stays in the foreground; the tone shows as
 * an icon of its own shape or a border next to it, never a tinted KPI tile. These components carry
 * figures, so no tone colour may reach their text (SSR, the house render path).
 */

const STATUS = ["info", "success", "warning", "danger"] as const
const TONES: ToneVariant[] = ["neutral", ...STATUS]
/** Any tone used as a TEXT colour: the raw status colour or its -ink role. */
const TONE_AS_TEXT = /\btext-(?:success|warning|danger|info)(?:-ink)?\b/

describe("figures never take a tone colour", () => {
  it("KpiGrid: trend lines and toned trends keep their text in the foreground", () => {
    const html = renderToStaticMarkup(
      <KpiGrid
        cells={[
          { label: "Up", value: "12", trend: "+12% vs last week", trendDirection: "up" },
          { label: "Down", value: "3", trend: "-4% vs last week", trendDirection: "down" },
          { label: "Flat", value: "7", trend: "±0", trendDirection: "flat" },
          ...STATUS.map((tone) => ({ label: tone, value: "1", trend: tone, trendTone: tone })),
        ]}
      />,
    )
    // Icons draw in the tone (SVG currentColor, TONE_ICON); no WORD or digit does.
    const words = html.replace(/<svg[\s\S]*?<\/svg>/g, "")
    expect(words).not.toMatch(TONE_AS_TEXT)
    // The tone is still there, as an icon of its own shape, never a tile's tint or a dot.
    expect(html).not.toMatch(/\bbg-(?:danger|warning|success|info)(?:-soft)?\b/)
    expect(html).toMatch(/<svg[^>]*class="lucide lucide-circle-x[^"]*text-danger"/)
    expect(html).toMatch(/<svg[^>]*class="[^"]*lucide-triangle-alert[^"]*text-warning"/)
    expect(html).toMatch(/<svg[^>]*class="lucide lucide-trending-up[^"]*text-danger"/)
    expect(html).toMatch(/<svg[^>]*class="lucide lucide-trending-down[^"]*text-success"/)
    // A toned trend reads in the foreground, an untoned one stays quiet.
    expect(html).toMatch(/<span class="text-foreground">\+12% vs last week<\/span>/)
    expect(html).toMatch(/<span class="text-muted-foreground">±0<\/span>/)
  })

  it.each(TONES)(
    "CountPill and LivePill (%s): number and label in the foreground, tone on the rim",
    (tone) => {
      const count = renderToStaticMarkup(<CountPill tone={tone}>42</CountPill>)
      const live = renderToStaticMarkup(<LivePill tone={tone}>Live</LivePill>)
      for (const html of [count, live]) {
        expect(html).not.toMatch(TONE_AS_TEXT)
        if (tone !== "neutral") {
          expect(html).toContain("text-foreground")
          expect(html).toContain(`border-${tone}`)
        }
      }
    },
  )
})
