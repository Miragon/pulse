import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ExternalLink } from "lucide-react"
import { attribute, openingTags, userFacingTexts } from "../render-scan.js"
import { buttonVariants } from "../primitives/button.js"
import { DrillButton } from "./DrillButton.js"

const noop = () => undefined
const classOf = (tag: string | undefined) => attribute(tag ?? "", "class") ?? ""

describe("DrillButton: the outline Button with a trailing arrow (mcp-toolkit#194)", () => {
  it("sm is a Button size sm: 32 px, 14 px, weight 600, like the buttons beside it in a row", () => {
    const html = renderToStaticMarkup(<DrillButton onDrill={noop}>Open</DrillButton>)
    const [button] = openingTags(html, "button")
    expect(classOf(button)).toBe(buttonVariants({ variant: "outline", size: "sm" }))
    expect(classOf(button)).toMatch(/\bh-8\b/)
    expect(classOf(button)).toMatch(/\btext-sm\b/)
    expect(classOf(button)).toMatch(/\bfont-semibold\b/)
    expect(attribute(button ?? "", "type")).toBe("button")
  })

  it("md is the Button default size (surface headers)", () => {
    const html = renderToStaticMarkup(
      <DrillButton onDrill={noop} size="md">
        View running instances
      </DrillButton>,
    )
    expect(classOf(openingTags(html, "button")[0])).toBe(
      buttonVariants({ variant: "outline", size: "default" }),
    )
  })

  it("keeps its words: the label, a decorative leading icon and a decorative trailing arrow", () => {
    const html = renderToStaticMarkup(
      <DrillButton onDrill={noop} icon={<ExternalLink />} ariaLabel="Open order o-1001">
        Open
      </DrillButton>,
    )
    const [button] = openingTags(html, "button")
    expect(attribute(button ?? "", "aria-label")).toBe("Open order o-1001")
    expect(userFacingTexts(html).map((t) => t.value)).toContain("Open")
    const svgs = openingTags(html, "svg")
    expect(svgs).toHaveLength(2)
    expect(svgs.at(-1)).toContain("lucide-arrow-right")
    for (const svg of svgs) expect(attribute(svg, "aria-hidden")).toBe("true")
    expect(openingTags(html, "span")[0]).toContain('aria-hidden="true"')
  })
})
