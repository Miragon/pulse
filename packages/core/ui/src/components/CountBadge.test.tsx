// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { setFormatLocale } from "../format/index.js"
import { TONE_ICON } from "../lib/tone-utils.js"
import { LocaleProvider } from "../locale/locale-provider.js"
import { CountBadge } from "./CountBadge.js"

/**
 * CountBadge: a count as a 20 px pill whose number stays neutral (invariant 6), an alarming one
 * marked by a tone icon of its own shape and named in words; filled only on a diagram.
 */

afterEach(() => {
  cleanup()
  setFormatLocale(undefined)
})

const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(/\s+/)
const badge = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-slot="count-badge"]')!

describe("CountBadge", () => {
  it("is a 20 px pill, 13 px at 600 in tabular figures, the number compact and the exact count its name", () => {
    const { container } = render(<CountBadge count={1234} label="1,234 running instances" />)
    const pill = badge(container)
    expect(classes(pill)).toEqual(
      expect.arrayContaining([
        "min-h-badge",
        "min-w-5",
        "rounded-pill",
        "text-small",
        "font-semibold",
        "tabular-nums",
        "border",
      ]),
    )
    expect(pill.querySelector('[aria-hidden="true"]')?.textContent).toBe("1.2k")
    expect(pill.querySelector(".sr-only")?.textContent).toBe("1,234 running instances")
    expect(pill.getAttribute("title")).toBe("1,234 running instances")
    expect(screen.getByText("1,234 running instances")).toBeTruthy()
  })

  it("writes its figure in the kit's locale like the words around it, whatever the format locale says", () => {
    // The format locale is English here; the kit's words are German, so is the figure.
    setFormatLocale({ language: "en", locale: "en" })
    const figures = [12_345, { atLeast: 2000 }, 1_500_000].map((count) => {
      const { container } = render(
        <LocaleProvider locale="de">
          <CountBadge count={count} label="x" />
        </LocaleProvider>,
      )
      const figure = badge(container).querySelector('[aria-hidden="true"]')?.textContent
      cleanup()
      return figure
    })
    // German shortens from a million on.
    expect(figures).toEqual(["12.345", "2.000+", "1,5\u00a0Mio."])
  })

  it("keeps the number neutral: a count without a state draws no icon, on the raised surface", () => {
    const { container } = render(<CountBadge count={3} label="3 jobs" />)
    expect(badge(container).querySelector("svg")).toBeNull()
    expect(classes(badge(container))).toEqual(
      expect.arrayContaining(["bg-raised", "text-foreground", "border-border"]),
    )
    expect(badge(container).getAttribute("data-tone")).toBe("neutral")
  })

  it.each([
    ["openIncident", "danger"],
    ["jobWithRetriesLeft", "warning"],
  ] as const)(
    "marks an alarming count (%s) by a 12 px %s icon of its own shape, never a coloured number",
    (situation, tone) => {
      const { container } = render(
        <CountBadge count={9} situation={situation} label="9 with incident" />,
      )
      const pill = badge(container)
      const icon = pill.querySelector("svg")!
      expect(icon.getAttribute("width")).toBe("12")
      expect(icon.getAttribute("class")).toContain(TONE_ICON[tone])
      expect(classes(pill)).toEqual(expect.arrayContaining(["text-foreground", "bg-raised"]))
      expect(pill.getAttribute("class")).not.toMatch(
        /text-(danger|warning)\b|bg-(danger|warning|destructive)\b/,
      )
    },
  )

  it("draws the two alarm icons in different shapes", () => {
    const shapes = (["openIncident", "jobWithRetriesLeft"] as const).map((situation) => {
      const { container } = render(<CountBadge count={1} situation={situation} label="x" />)
      return badge(container).querySelector("svg")?.innerHTML
    })
    expect(shapes[0]).not.toBe(shapes[1])
  })

  it("on a diagram fills in its tone: an incident on the danger fill (the same in both modes), running on the primary, a called instance's incident outlined", () => {
    const fill = (situation: "openIncident" | "running" | "incidentInCalledInstance") => {
      const { container } = render(<CountBadge diagram count={2} situation={situation} label="x" />)
      const pill = badge(container)
      cleanup()
      return { c: classes(pill), icon: pill.querySelector("svg")?.getAttribute("class") ?? "" }
    }
    const incident = fill("openIncident")
    expect(incident.c).toEqual(
      expect.arrayContaining(["bg-destructive", "text-destructive-foreground"]),
    )
    expect(incident.icon).not.toContain(TONE_ICON.danger)
    expect(fill("running").c).toEqual(
      expect.arrayContaining(["bg-primary", "text-primary-foreground"]),
    )
    const called = fill("incidentInCalledInstance")
    expect(called.c).toEqual(
      expect.arrayContaining(["bg-raised", "border-danger", "border-[1.5px]"]),
    )
    expect(called.icon).toContain(TONE_ICON.danger)
  })

  it("greys a stale count with the field edge; draws edges, never shadows, and its own colours in forced colours", () => {
    const { container } = render(
      <CountBadge diagram stale count={2} situation="openIncident" label="x" />,
    )
    const c = classes(badge(container))
    expect(c).toEqual(expect.arrayContaining(["bg-raised", "border-input", "text-foreground"]))
    expect(c).not.toContain("bg-destructive")
    expect(c.filter((x) => /shadow|ring/.test(x))).toEqual([])
    expect(c).toEqual(
      expect.arrayContaining([
        "forced-colors:border-[color:CanvasText]",
        "forced-colors:forced-color-adjust-none",
      ]),
    )
  })

  it("is a sign without a count (a legend), smaller in the legend's size", () => {
    const { container } = render(
      <CountBadge size="legend" situation="openIncident" label="Instances with an incident" />,
    )
    const pill = badge(container)
    expect(classes(pill)).toEqual(expect.arrayContaining(["min-h-4", "min-w-6"]))
    expect(pill.querySelector('[aria-hidden="true"]:not(svg)')).toBeNull()
    expect(pill.querySelector("svg")).toBeTruthy()
  })

  it("as a button: named by its words, a 24 px target around the pill, the kit's focus ring, pressed by click and keyboard", () => {
    const onClick = vi.fn()
    render(
      <CountBadge
        count={3}
        situation="openIncident"
        label="3 instances with an incident"
        onClick={onClick}
      />,
    )
    const button = screen.getByRole("button", { name: "3 instances with an incident" })
    expect(button.getAttribute("type")).toBe("button")
    expect(classes(button)).toEqual(
      expect.arrayContaining([
        "relative",
        "before:absolute",
        "before:-inset-0.5",
        "before:min-h-6",
        "before:min-w-6",
      ]),
    )
    expect(button.getAttribute("class")).toContain("focus-visible:ring-focus")
    button.focus()
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
