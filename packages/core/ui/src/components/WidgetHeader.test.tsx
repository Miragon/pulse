import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { MICRO_LABEL } from "../lib/typography.js"
import { attribute, openingTags } from "../render-scan.js"
import { StatusBadge } from "./Pills.js"
import { SectionHeading } from "./SectionHeading.js"
import { WidgetHeader, type WidgetHeadingLevel } from "./WidgetHeader.js"

const classOf = (tag: string | undefined) => attribute(tag ?? "", "class") ?? ""

describe("WidgetHeader: a view's bar, the hero only at app level", () => {
  it("is the view's ViewBar by default: an h1 as the bar's 13 px heading at 600", () => {
    const html = renderToStaticMarkup(<WidgetHeader title="Incidents" />)
    expect(attribute(openingTags(html, "header")[0] ?? "", "data-slot")).toBe("view-bar")
    const heading = classOf(openingTags(html, "h1")[0])
    expect(heading).toMatch(/(^| )text-dense( |$)/)
    expect(heading).toContain("font-semibold")
    expect(html).not.toMatch(/text-title|text-section|text-3xl|text-xs/)
  })

  it.each(["h2", "h3", "h4", "h5", "h6"] satisfies WidgetHeadingLevel[])(
    "takes the heading level %s from `as`, keeping the bar's size",
    (level) => {
      const html = renderToStaticMarkup(<WidgetHeader as={level} title="Incidents" />)
      expect(classOf(openingTags(html, level)[0])).toMatch(/(^| )text-dense( |$)/)
      expect(html).toMatch(new RegExp(`<${level}[^>]*><span[^>]*>Incidents</span></${level}>`))
      expect(html).not.toContain("<h1")
    },
  )

  it("draws the same bar for the detail size; the app level keeps the 28 px hero at 700", () => {
    const detail = renderToStaticMarkup(<WidgetHeader as="h2" size="detail" title="Instance" />)
    expect(classOf(openingTags(detail, "h2")[0])).toMatch(/(^| )text-dense( |$)/)
    const app = renderToStaticMarkup(<WidgetHeader as="h2" size="app" title="All engines" />)
    expect(attribute(openingTags(app, "header")[0] ?? "", "data-slot")).toBe("widget-header")
    expect(classOf(openingTags(app, "h2")[0])).toContain("text-title")
    expect(app).not.toContain("view-bar")
  })

  it("puts the state after the title, a suffix inside the heading, the meta as facts and the actions in one group", () => {
    const html = renderToStaticMarkup(
      <WidgetHeader
        title="Invoice"
        titleSuffix={<span>v3</span>}
        badge={<StatusBadge tone="warning">Suspended</StatusBadge>}
        sub="Updated 14:32"
        actions={<button type="button">Refresh</button>}
      />,
    )
    expect(html.indexOf("Suspended")).toBeGreaterThan(html.indexOf("</h1>"))
    expect(html).toMatch(/<h1[^>]*><span[^>]*>Invoice<\/span><span>v3<\/span><\/h1>/)
    expect(html).toMatch(/data-slot="view-bar-facts"[^>]*>Updated 14:32</)
    expect(html).toMatch(
      /data-slot="view-bar-actions"[^>]*><button type="button">Refresh<\/button>/,
    )
    // The facts are captions at the 13 px step, quiet.
    const facts = openingTags(html, "div").find((t) => /view-bar-facts/.test(t))
    expect(classOf(facts)).toMatch(/(^| )text-small( |$)/)
    expect(classOf(facts)).toContain("text-muted-foreground")
    expect(html).not.toContain("size-11")
  })

  it("draws the deprecated icon at 16 px before the title, hidden from assistive tech, no tile", () => {
    const html = renderToStaticMarkup(<WidgetHeader icon={<svg />} iconTone="info" title="Tasks" />)
    const slot = openingTags(html, "span").find((t) => /aria-hidden="true"/.test(t))
    expect(classOf(slot)).toContain("[&_svg:not([class*='size-'])]:size-4")
    expect(html).toContain('class="text-info"')
    expect(html).not.toMatch(/size-11|bg-info-soft/)
  })

  it("merges a className onto the bar", () => {
    const html = renderToStaticMarkup(<WidgetHeader title="x" className="mb-6" />)
    expect(classOf(openingTags(html, "header")[0])).toContain("mb-6")
  })
})

describe("SectionHeading: a block label inside a widget body", () => {
  it("is a 13 px caption (MICRO_LABEL) in the foreground, the webview's section title; its hint quiet", () => {
    const html = renderToStaticMarkup(<SectionHeading title="Recent" hint="3 new" />)
    const row = classOf(openingTags(html, "div")[0])
    expect(row).toContain(MICRO_LABEL)
    expect(row).toContain("text-foreground")
    expect(row).not.toContain("text-muted-foreground")
    expect(classOf(openingTags(html, "span")[1])).toContain("text-muted-foreground")
    expect(html).not.toMatch(/\btext-dense\b/)
  })

  it("puts its title at the level it is given, with the id a section is labelled by", () => {
    const html = renderToStaticMarkup(
      <SectionHeading as="h2" id="clusters" title="Failure clusters" className="mb-0" />,
    )
    const heading = openingTags(html, "h2")[0] ?? ""
    expect(attribute(heading, "id")).toBe("clusters")
    expect(classOf(heading)).toContain(MICRO_LABEL)
    const row = classOf(openingTags(html, "div")[0])
    expect(row).toContain("mb-0")
    expect(row).not.toContain("mb-3")
  })

  it("is a caption outside the outline by default", () => {
    const html = renderToStaticMarkup(<SectionHeading title="Recent" />)
    expect(html).not.toMatch(/<h[1-6]/)
  })
})
