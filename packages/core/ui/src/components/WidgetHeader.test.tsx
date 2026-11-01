import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { MICRO_LABEL } from "../lib/typography.js"
import { attribute, openingTags } from "../render-scan.js"
import { StatusBadge } from "./Pills.js"
import { SectionHeading } from "./SectionHeading.js"
import { WidgetHeader, type WidgetHeadingLevel } from "./WidgetHeader.js"

const classOf = (tag: string | undefined) => attribute(tag ?? "", "class") ?? ""

describe("WidgetHeader: one title at the level of its surface", () => {
  it("is an h1 at the page-title size by default", () => {
    const html = renderToStaticMarkup(<WidgetHeader title="Incidents" />)
    expect(html).toMatch(/<h1 class="[^"]*text-title[^"]*">Incidents<\/h1>/)
    expect(html).not.toMatch(/text-3xl|text-xs/)
  })

  it.each(["h2", "h3", "h4", "h5", "h6"] satisfies WidgetHeadingLevel[])(
    "takes the heading level %s from `as`, keeping the size",
    (level) => {
      const html = renderToStaticMarkup(<WidgetHeader as={level} title="Incidents" />)
      expect(html).toMatch(
        new RegExp(`<${level} class="[^"]*text-title[^"]*">Incidents</${level}>`),
      )
      expect(html).not.toContain("<h1")
    },
  )

  it("renders the compact detail size at the section step", () => {
    const html = renderToStaticMarkup(<WidgetHeader as="h2" size="detail" title="Instance" />)
    expect(classOf(openingTags(html, "h2")[0])).toContain("text-section")
    expect(classOf(openingTags(html, "h2")[0])).not.toContain("text-title")
  })

  it("puts a state badge above the title and a suffix inside the heading", () => {
    const html = renderToStaticMarkup(
      <WidgetHeader
        title="Invoice"
        titleSuffix={<span>v3</span>}
        badge={<StatusBadge tone="warning">Suspended</StatusBadge>}
        sub="Updated 14:32"
        actions={<button type="button">Refresh</button>}
      />,
    )
    expect(html.indexOf("Suspended")).toBeLessThan(html.indexOf("<h1"))
    expect(html).toMatch(/<h1[^>]*>Invoice<span>v3<\/span><\/h1>/)
    expect(html).toContain("Updated 14:32")
    expect(html).toContain("Refresh</button>")
    expect(html).not.toContain("size-11")
    // The meta row is a caption at the 13 px step, not running text in the
    // dense-table size.
    const meta = openingTags(html, "div").find((t) => /flex-wrap items-center gap-2/.test(t))
    expect(classOf(meta)).toMatch(/(^| )text-small( |$)/)
    expect(html).not.toMatch(/\btext-dense\b/)
  })

  it("still renders the deprecated icon tile, hidden from assistive tech", () => {
    const html = renderToStaticMarkup(<WidgetHeader icon={<svg />} iconTone="info" title="Tasks" />)
    const tile = openingTags(html, "div").find((t) => /size-11/.test(t))
    expect(attribute(tile ?? "", "aria-hidden")).toBe("true")
    expect(classOf(tile)).toContain("bg-info-soft")
  })

  it("merges a className onto the header", () => {
    const html = renderToStaticMarkup(<WidgetHeader title="x" className="mb-6" />)
    expect(classOf(openingTags(html, "header")[0])).toContain("mb-6")
  })
})

describe("SectionHeading: a block label inside a widget body", () => {
  it("is a 13 px caption (MICRO_LABEL), never in the dense-table size", () => {
    const html = renderToStaticMarkup(<SectionHeading title="Recent" hint="3 new" />)
    const row = classOf(openingTags(html, "div")[0])
    expect(row).toContain(MICRO_LABEL)
    expect(row).toContain("text-muted-foreground")
    expect(html).not.toMatch(/\btext-dense\b/)
  })
})
