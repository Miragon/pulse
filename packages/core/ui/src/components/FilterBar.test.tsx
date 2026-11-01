import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { LocaleProvider } from "../locale/locale-provider.js"
import { UI_MESSAGES } from "../locale/ui-messages.js"
import { attribute, openingTags } from "../render-scan.js"
import { FOCUS_RING } from "../lib/focus-ring.js"
import { TONE_BORDER, TONE_SOFT } from "../lib/tone-utils.js"
import { FilterBar } from "./FilterBar.js"

const noop = (): void => {}
const classOf = (tag: string | undefined) => attribute(tag ?? "", "class") ?? ""

function render(props: Partial<Parameters<typeof FilterBar>[0]> = {}, locale = "en") {
  return renderToStaticMarkup(
    <LocaleProvider locale={locale}>
      <FilterBar
        search=""
        onSearchChange={noop}
        chips={[
          { id: "open", label: "Open", count: 3, active: true },
          { id: "done", label: "Done" },
        ]}
        onChipToggle={noop}
        {...props}
      />
    </LocaleProvider>,
  )
}

describe("FilterBar: a labelled search and toggle chips", () => {
  it("labels the search input in the locale (a placeholder is no label)", () => {
    const [input] = openingTags(render(), "input")
    expect(attribute(input ?? "", "type")).toBe("search")
    expect(attribute(input ?? "", "aria-label")).toBe(UI_MESSAGES.en.filterBar.searchLabel)
    expect(attribute(input ?? "", "placeholder")).toBe("Filter…")
    const [german] = openingTags(render({}, "de-DE"), "input")
    expect(attribute(german ?? "", "aria-label")).toBe("Filtern")
    expect(attribute(german ?? "", "placeholder")).toBe("Filtern…")
  })

  it("takes the caller's search label and placeholder", () => {
    const [input] = openingTags(
      render({ searchAriaLabel: "Filter tasks", searchPlaceholder: "Filter tasks…" }),
      "input",
    )
    expect(attribute(input ?? "", "aria-label")).toBe("Filter tasks")
    expect(attribute(input ?? "", "placeholder")).toBe("Filter tasks…")
  })

  it("groups the chips under a name and marks each one's state with aria-pressed", () => {
    const html = render()
    const group = openingTags(html, "div").find((t) => attribute(t, "role") === "group")
    expect(attribute(group ?? "", "aria-label")).toBe("Filters")
    expect(
      attribute(openingTags(render({ chipsAriaLabel: "Priority" }), "div")[1] ?? "", "aria-label"),
    ).toBe("Priority")
    const [open, done] = openingTags(html, "button")
    expect(attribute(open ?? "", "aria-pressed")).toBe("true")
    expect(attribute(done ?? "", "aria-pressed")).toBe("false")
    for (const chip of [open, done]) {
      expect(attribute(chip ?? "", "type")).toBe("button")
      expect(classOf(chip)).toContain(FOCUS_RING)
      expect(classOf(chip)).toContain("text-small")
    }
  })

  it("shows the active chip as a selection: info tint and edge around foreground text", () => {
    const [open, done] = openingTags(render(), "button")
    expect(classOf(open)).toContain(TONE_SOFT.info)
    expect(classOf(open)).toContain(TONE_BORDER.info)
    expect(classOf(open)).not.toMatch(/text-info|text-accent-foreground/)
    expect(classOf(done)).toContain("text-muted-foreground")
    expect(classOf(done)).not.toContain("bg-info-soft")
  })

  it("renders no empty group without chips and merges a className", () => {
    const html = render({ chips: [], className: "mb-4" })
    expect(html).not.toContain('role="group"')
    expect(classOf(openingTags(html, "div")[0])).toContain("mb-4")
    expect(html).not.toMatch(/text-xs|text-\[\d+px\]/)
  })
})
