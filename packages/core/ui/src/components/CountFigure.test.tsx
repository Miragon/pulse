// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { CountFigure } from "./CountFigure.js"

/** CountFigure: a neutral figure; an alarming one adds its tone's icon of its own shape and words. */

afterEach(cleanup)

const TONE_AS_TEXT = /\btext-(?:success|warning|danger|info)(?:-ink)?\b/

describe("CountFigure", () => {
  it("a count without a state is the figure alone, in tabular digits", () => {
    const { container } = render(<CountFigure>1,234</CountFigure>)
    const figure = container.querySelector('[data-slot="count-figure"]')!
    expect(figure.textContent).toBe("1,234")
    expect(figure.getAttribute("data-tone")).toBe("neutral")
    expect(figure.getAttribute("class")).toContain("tabular-nums")
    expect(figure.querySelector("svg")).toBeNull()
  })

  it.each([
    ["openIncident", "danger", "lucide-circle-x"],
    ["jobWithoutRetries", "danger", "lucide-circle-x"],
    ["jobWithRetriesLeft", "warning", "lucide-triangle-alert"],
  ] as const)(
    "%s: a 16 px %s icon of its own shape before the figure, the words after it",
    (situation, tone, glyph) => {
      const { container } = render(
        <CountFigure situation={situation} label="Why it alarms">
          3
        </CountFigure>,
      )
      const figure = container.querySelector('[data-slot="count-figure"]')!
      expect(figure.getAttribute("data-tone")).toBe(tone)
      const icon = figure.querySelector("svg")!
      expect(icon.getAttribute("class")).toContain(glyph)
      expect(icon.getAttribute("class")).toContain(`text-${tone}`)
      expect(icon.getAttribute("width")).toBe("16")
      expect(icon.getAttribute("aria-hidden")).toBe("true")
      expect(figure.textContent).toBe("3Why it alarms")
      expect(figure.querySelector(".sr-only")?.textContent).toBe("Why it alarms")
      // The figure itself never takes the tone's colour.
      const words = figure.innerHTML.replace(/<svg[\s\S]*?<\/svg>/g, "")
      expect(words).not.toMatch(TONE_AS_TEXT)
    },
  )

  it("a situation that does not alarm draws no icon and says nothing more", () => {
    const { container } = render(
      <CountFigure situation="running" label="Running">
        5
      </CountFigure>,
    )
    expect(container.querySelector("svg")).toBeNull()
    expect(container.textContent).toBe("5")
  })
})
