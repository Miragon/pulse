// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { setFormatLocale } from "@miragon/pulse-ui"
import { catalogTextFindings } from "@miragon/pulse-ui/testing"
import { VIEW_META_LABELS, ViewMeta, formatLookback, formatViewMeta } from "./view-meta.js"

afterEach(() => {
  cleanup()
  setFormatLocale(undefined)
})

const NOW = new Date("2026-10-10T12:40:00.000Z")
const AS_OF = "2026-10-10T12:32:00.000Z"

/** The formatters keep a number and its unit together with a non-breaking space. */
const plain = (s: string) => s.replace(/\u00a0/g, " ")

const german = () => setFormatLocale({ language: "de", locale: "de-DE", timeZone: "Europe/Berlin" })
const english = () =>
  setFormatLocale({ language: "en", locale: "en-GB", timeZone: "Europe/Berlin" })

describe("formatLookback: a period token as the frame of a view", () => {
  it("names the last n units in German and English", () => {
    german()
    expect(plain(formatLookback("7d"))).toBe("Letzte 7 Tage")
    expect(plain(formatLookback("30d"))).toBe("Letzte 30 Tage")
    expect(plain(formatLookback("2w"))).toBe("Letzte 2 Wochen")
    english()
    expect(plain(formatLookback("7d"))).toBe("Last 7 days")
    expect(plain(formatLookback("14d"))).toBe("Last 14 days")
  })

  it("reads a single day or week as its length, never as yesterday or last week", () => {
    german()
    expect(plain(formatLookback("1d"))).toBe("Letzte 24 Stunden")
    expect(plain(formatLookback("1w"))).toBe("Letzte 7 Tage")
    expect(plain(formatLookback("1h"))).toBe("Letzte Stunde")
    expect(plain(formatLookback("1m"))).toBe("Letzte Minute")
    english()
    expect(plain(formatLookback("1d"))).toBe("Last 24 hours")
    expect(plain(formatLookback("1H"))).toBe("Last hour")
    expect(plain(formatLookback("1m"))).toBe("Last minute")
  })

  it("passes a custom window through and renders nothing for no period", () => {
    english()
    expect(plain(formatLookback("since Monday"))).toBe("since Monday")
    expect(plain(formatLookback(undefined))).toBe("")
    expect(plain(formatLookback(""))).toBe("")
  })
})

describe("formatViewMeta: period · engines · as-of", () => {
  it("joins the known parts in German (the U7 reference line)", () => {
    german()
    expect(
      plain(
        formatViewMeta(
          { period: formatLookback("7d"), engines: { count: 6, silent: 3 }, asOf: AS_OF },
          NOW,
        ),
      ),
    ).toBe("Letzte 7 Tage · 6 Engines (3 ohne Metriken) · Stand 14:32")
  })

  it("joins the known parts in English, the subject first", () => {
    english()
    expect(
      plain(
        formatViewMeta(
          {
            subject: "order",
            period: formatLookback("14d"),
            engines: { count: 1 },
            asOf: AS_OF,
          },
          NOW,
        ),
      ),
    ).toBe("order · Last 14 days · 1 engine · As of 14:32")
  })

  it("leaves out what is unknown: no silent count, no period, a broken timestamp", () => {
    german()
    expect(formatViewMeta({ engines: { count: 2, silent: 0 }, asOf: "kaputt" }, NOW)).toBe(
      "2 Engines",
    )
    expect(formatViewMeta({ engines: { count: 1, silent: null } }, NOW)).toBe("1 Engine")
    expect(formatViewMeta({}, NOW)).toBe("")
  })

  it("dates an as-of time that is not from today", () => {
    german()
    expect(formatViewMeta({ asOf: "2026-10-08T07:05:00.000Z" }, NOW)).toBe("Stand 8.10.2026, 09:05")
  })
})

describe("ViewMeta", () => {
  it("renders the line as quiet text", () => {
    english()
    const { container } = render(<ViewMeta engines={{ count: 3, silent: 1 }} />)
    const line = container.querySelector("[data-view-meta]")
    expect(line?.textContent).toBe("3 engines (1 without metrics)")
    expect(line?.className).toContain("text-muted-foreground")
  })

  it("renders nothing when no part is known", () => {
    const { container } = render(<ViewMeta period={null} />)
    expect(container.innerHTML).toBe("")
  })
})

describe("the meta line's words follow the voice rules", () => {
  it.each([
    ["de", VIEW_META_LABELS.de],
    ["en", VIEW_META_LABELS.en],
  ] as const)("%s", (language, catalog) => {
    expect(catalogTextFindings(catalog, { language })).toEqual([])
  })
})
